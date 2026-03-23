import { spawn, type ChildProcess } from "node:child_process";

import type {
  ChatMode,
  ChatUsage,
  RuntimeAuthStatus,
  StreamStatusEvent,
  StreamToolEvent,
  UploadItem,
} from "@/lib/types";

export interface StreamResult {
  text: string;
  usage?: ChatUsage;
  aborted: boolean;
}

export interface StreamOptions {
  signal?: AbortSignal;
  onToken: (token: string) => void;
  onStatus?: (event: StreamStatusEvent) => void;
  onTool?: (event: StreamToolEvent) => void;
}

interface CodexRuntimeConfig {
  bin: string;
  cwd: string;
  sandbox: string;
  execTimeoutMs: number;
}

interface CodexEvent {
  type?: string;
  item?: {
    type?: string;
    text?: string;
    delta?: string;
  };
  delta?: string;
  usage?: ChatUsage;
}

interface StreamCommandInput {
  args: string[];
  cwd: string;
}

interface ExecCommandArgsInput {
  sandbox: string;
  model: string;
  message: string;
  images?: string[];
}

function extractJsonLines(chunk: string, carry: string): { lines: string[]; carry: string } {
  const merged = carry + chunk;
  const lines = merged.split(/\r?\n/);
  const nextCarry = lines.pop() ?? "";
  return { lines, carry: nextCarry };
}

function chunkText(text: string, size = 24): string[] {
  const tokens: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    tokens.push(text.slice(index, index + size));
  }
  return tokens;
}

function terminateProcessTree(child: ChildProcess) {
  if (process.platform === "win32" && child.pid) {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }

  if (!child.killed) {
    child.kill();
  }
}

function parseAuthStatus(stdout: string): RuntimeAuthStatus {
  const normalized = stdout.trim().toLowerCase();

  if (normalized.includes("logged in using chatgpt")) {
    return { ready: true, loginMethod: "chatgpt", message: "Logged in with ChatGPT." };
  }

  if (normalized.includes("api key")) {
    return { ready: true, loginMethod: "api", message: "Logged in with API key." };
  }

  if (normalized.includes("not logged in")) {
    return { ready: false, loginMethod: "none", message: "Codex is not logged in." };
  }

  return { ready: false, loginMethod: "none", message: stdout.trim() || "Unknown auth state." };
}

function buildExecCommandArgs(input: ExecCommandArgsInput): string[] {
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--sandbox",
    input.sandbox,
    "--json",
    "--model",
    input.model,
  ];
  for (const image of input.images ?? []) {
    args.push("-i", image);
  }
  args.push(input.message);
  return args;
}

function buildExecResumeCommandArgs(input: ExecCommandArgsInput & { conversationId: string }): string[] {
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--sandbox",
    input.sandbox,
    "resume",
    "--json",
    "--model",
    input.model,
  ];
  for (const image of input.images ?? []) {
    args.push("-i", image);
  }
  args.push(input.conversationId, input.message);
  return args;
}

function buildPrompt(input: {
  mode?: ChatMode;
  message: string;
  textAttachments: UploadItem[];
}): string {
  const parts: string[] = [];

  if (input.mode === "plan") {
    parts.push(
      [
        "请使用计划模式回答：先澄清关键问题，再给出决策完整的实施计划。",
        "若信息不足，先列出需要确认的关键点。",
      ].join("\n"),
    );
  }

  if (input.textAttachments.length > 0) {
    const fileLines = input.textAttachments.map((item) => `- ${item.name}: ${item.path}`);
    parts.push(
      [
        "已上传文本文件如下，请按需读取并引用：",
        ...fileLines,
      ].join("\n"),
    );
  }

  parts.push(input.message);
  return parts.join("\n\n");
}

function splitAttachments(attachments: UploadItem[] | undefined): {
  imagePaths: string[];
  textFiles: UploadItem[];
} {
  const imagePaths: string[] = [];
  const textFiles: UploadItem[] = [];
  for (const item of attachments ?? []) {
    if (item.kind === "image") {
      imagePaths.push(item.path);
      continue;
    }
    if (item.kind === "text") {
      textFiles.push(item);
    }
  }
  return { imagePaths, textFiles };
}

export class CodexRuntimeAdapter {
  constructor(private readonly config: CodexRuntimeConfig) {}

  async getAuthStatus(): Promise<RuntimeAuthStatus> {
    const result = await this.runCommand(["login", "status"], this.config.cwd);

    if (result.exitCode !== 0) {
      return {
        ready: false,
        loginMethod: "none",
        message: result.stderr.trim() || "Unable to read Codex login status.",
      };
    }

    const combinedOutput = `${result.stdout}\n${result.stderr}`.trim();
    return parseAuthStatus(combinedOutput);
  }

  async streamNewSession(input: {
    model: string;
    message: string;
    cwd: string;
    sandbox?: string;
    mode?: ChatMode;
    attachments?: UploadItem[];
  }, options: StreamOptions): Promise<StreamResult> {
    const sandbox = input.sandbox ?? this.config.sandbox;
    const { imagePaths, textFiles } = splitAttachments(input.attachments);
    const prompt = buildPrompt({
      mode: input.mode,
      message: input.message,
      textAttachments: textFiles,
    });
    const command: StreamCommandInput = {
      cwd: input.cwd,
      args: buildExecCommandArgs({
        sandbox,
        model: input.model,
        message: prompt,
        images: imagePaths,
      }),
    };
    return this.runStreamingCommand(command, options);
  }

  async streamResumeSession(input: {
    conversationId: string;
    model: string;
    message: string;
    cwd: string;
    sandbox?: string;
    mode?: ChatMode;
    attachments?: UploadItem[];
  }, options: StreamOptions): Promise<StreamResult> {
    const sandbox = input.sandbox ?? this.config.sandbox;
    const { imagePaths, textFiles } = splitAttachments(input.attachments);
    const prompt = buildPrompt({
      mode: input.mode,
      message: input.message,
      textAttachments: textFiles,
    });
    const command: StreamCommandInput = {
      cwd: input.cwd,
      args: buildExecResumeCommandArgs({
        sandbox,
        model: input.model,
        conversationId: input.conversationId,
        message: prompt,
        images: imagePaths,
      }),
    };
    return this.runStreamingCommand(command, options);
  }

  private async runStreamingCommand(
    command: StreamCommandInput,
    options: StreamOptions,
  ): Promise<StreamResult> {
    const child = spawn(this.config.bin, command.args, {
      cwd: command.cwd,
      env: process.env,
      windowsHide: true,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdoutCarry = "";
    let stderrCarry = "";
    let stderrRaw = "";
    let bufferedText = "";
    let emittedAnyToken = false;
    let usage: ChatUsage | undefined;
    let aborted = false;
    const maybeAbort = () => {
      aborted = true;
      terminateProcessTree(child);
    };

    options.signal?.addEventListener("abort", maybeAbort, { once: true });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      const parsed = extractJsonLines(chunk, stdoutCarry);
      stdoutCarry = parsed.carry;

      for (const rawLine of parsed.lines) {
        const line = rawLine.trim();
        if (!line.startsWith("{")) {
          continue;
        }

        let event: CodexEvent;
        try {
          event = JSON.parse(line) as CodexEvent;
        } catch {
          continue;
        }

        if (event.type === "turn.completed") {
          usage = event.usage;
          options.onStatus?.({
            phase: "done",
            detail: "本轮生成完成",
          });
          continue;
        }

        if (event.type === "item.completed" && event.item?.type === "agent_message") {
          bufferedText += event.item.text ?? "";
          continue;
        }

        if (event.type === "turn.started") {
          options.onStatus?.({
            phase: "thinking",
            detail: "正在处理请求",
          });
        }

        if (event.item?.type === "function_call") {
          options.onTool?.({
            name: "tool_call",
            state: event.type === "item.completed" ? "end" : "start",
            summary: "调用工具处理中",
          });
        }

        const delta = event.item?.delta ?? event.delta;
        if (typeof delta === "string" && delta.length > 0) {
          emittedAnyToken = true;
          options.onToken(delta);
        }
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderrRaw += chunk;
      const parsed = extractJsonLines(chunk, stderrCarry);
      stderrCarry = parsed.carry;

      for (const rawLine of parsed.lines) {
        const line = rawLine.trim();
        if (line.length === 0) {
          continue;
        }

        if (line.startsWith("{")) {
          try {
            const event = JSON.parse(line) as CodexEvent;
            const delta = event.item?.delta ?? event.delta;
            if (typeof delta === "string" && delta.length > 0) {
              emittedAnyToken = true;
              options.onToken(delta);
            }
          } catch {
            // ignore stderr logs
          }
        }
      }
    });

    const closePromise = new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code ?? 1));
    });

    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<number>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        terminateProcessTree(child);
        reject(new Error(`Codex execution timed out after ${this.config.execTimeoutMs}ms.`));
      }, this.config.execTimeoutMs);
    });

    const exitCode = await Promise.race([closePromise, timeoutPromise]);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }

    options.signal?.removeEventListener("abort", maybeAbort);

    if (aborted) {
      return {
        text: bufferedText,
        usage,
        aborted: true,
      };
    }

    if (exitCode !== 0) {
      throw new Error(stderrRaw.trim() || `codex exec exited with code ${exitCode}`);
    }

    if (!emittedAnyToken && bufferedText) {
      for (const token of chunkText(bufferedText)) {
        options.onToken(token);
      }
    }

    return {
      text: bufferedText,
      usage,
      aborted: false,
    };
  }

  private async runCommand(args: string[], cwd: string): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }> {
    const child = spawn(this.config.bin, args, {
      cwd,
      env: process.env,
      windowsHide: true,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const closePromise = new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code ?? 1));
    });

    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<number>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        terminateProcessTree(child);
        reject(new Error(`Codex command timed out after ${this.config.execTimeoutMs}ms.`));
      }, this.config.execTimeoutMs);
    });

    let exitCode: number;
    try {
      exitCode = await Promise.race([closePromise, timeoutPromise]);
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    } catch (error) {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      const message =
        error instanceof Error ? error.message : "Codex command timed out.";
      return {
        stdout,
        stderr: `${stderr}\n${message}`.trim(),
        exitCode: 1,
      };
    }

    return {
      stdout,
      stderr,
      exitCode,
    };
  }
}

let singleton: CodexRuntimeAdapter | null = null;

export function getCodexRuntime(config: CodexRuntimeConfig): CodexRuntimeAdapter {
  if (!singleton) {
    singleton = new CodexRuntimeAdapter(config);
  }

  return singleton;
}

export function parseAuthStatusForTests(stdout: string): RuntimeAuthStatus {
  return parseAuthStatus(stdout);
}

export function buildExecArgsForTests(input: ExecCommandArgsInput): string[] {
  return buildExecCommandArgs(input);
}

export function buildExecResumeArgsForTests(
  input: ExecCommandArgsInput & { conversationId: string },
): string[] {
  return buildExecResumeCommandArgs(input);
}
