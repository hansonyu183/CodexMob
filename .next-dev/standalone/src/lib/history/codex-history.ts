import path from "node:path";
import { promises as fs } from "node:fs";

import { appendJsonl, readJsonl } from "@/lib/history/jsonl";
import { getCodexHome } from "@/lib/history/paths";
import type { ChatRole, HistoryConversation, HistoryMessage, SourceKind } from "@/lib/types";

interface SessionIndexRow {
  id: string;
  thread_name?: string;
  updated_at?: string;
}

interface SessionLine {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
}

interface SessionMeta {
  id: string;
  cwd: string | null;
  model?: string;
}

interface CodexGlobalState {
  "electron-saved-workspace-roots"?: unknown;
  "active-workspace-roots"?: unknown;
  "thread-workspace-root-hints"?: unknown;
}

function asString(input: unknown): string | undefined {
  return typeof input === "string" ? input : undefined;
}

function nowIso(): string {
  return new Date().toISOString();
}

function safeTitle(input: string | undefined): string {
  const trimmed = (input ?? "").trim();
  return trimmed.length > 0 ? trimmed : "新会话";
}

function extractMessageText(payload: Record<string, unknown>): string | undefined {
  const directText = asString(payload.message);
  if (directText?.trim()) {
    return directText.trim();
  }

  const content = payload.content;
  if (!Array.isArray(content)) {
    return undefined;
  }

  const parts = content
    .map((item) => {
      if (typeof item !== "object" || item === null) {
        return "";
      }
      const row = item as Record<string, unknown>;
      return asString(row.text) ?? "";
    })
    .filter(Boolean);

  const text = parts.join("\n").trim();
  return text || undefined;
}

function isInjectedContextText(content: string): boolean {
  const normalized = content.trim();
  const lowered = normalized.toLowerCase();

  if (!normalized) {
    return false;
  }

  if (normalized.startsWith("# AGENTS.md instructions for ")) {
    return true;
  }
  if (normalized.startsWith("<environment_context>")) {
    return true;
  }
  if (normalized.includes("\n<environment_context>")) {
    return true;
  }
  if (normalized.startsWith("<INSTRUCTIONS>")) {
    return true;
  }
  if (lowered.includes("# global agent rules") && lowered.includes("<instructions>")) {
    return true;
  }
  if (
    lowered.includes("you are codex, a coding agent based on gpt-5") &&
    lowered.includes("collaboration mode")
  ) {
    return true;
  }

  return false;
}

function isVisibleChatMessage(role: ChatRole, content: string): boolean {
  if (role !== "user") {
    return true;
  }
  return !isInjectedContextText(content);
}

async function listJsonlFiles(rootDir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(current: string) {
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        results.push(fullPath);
      }
    }
  }

  await walk(rootDir);
  return results;
}

function sessionFileName(conversationId: string): string {
  const stamp = nowIso().replace(/:/g, "-").replace(/\..+$/, "");
  return `rollout-${stamp}-${conversationId}.jsonl`;
}

function normalizeRole(role: unknown): ChatRole | null {
  if (role === "user" || role === "assistant" || role === "system") {
    return role;
  }
  return null;
}

function normalizePathForPrefix(input: string): string {
  const normalized = path.resolve(input).replaceAll("\\", "/").replace(/\/+$/, "");
  if (process.platform === "win32") {
    return normalized.toLowerCase();
  }
  return normalized;
}

function isInsidePath(input: string, root: string): boolean {
  const normalizedInput = normalizePathForPrefix(input);
  const normalizedRoot = normalizePathForPrefix(root);
  return (
    normalizedInput === normalizedRoot ||
    normalizedInput.startsWith(`${normalizedRoot}/`)
  );
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function isRealWorkspaceCwd(cwd: string | undefined, codexHome: string): Promise<boolean> {
  if (!cwd?.trim()) {
    return false;
  }
  if (!(await pathExists(cwd))) {
    return false;
  }
  const worktreesRoot = path.join(codexHome, "worktrees");
  if (isInsidePath(cwd, worktreesRoot)) {
    return false;
  }
  return true;
}

function asStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((item) => (typeof item === "string" ? item : ""))
    .map((item) => item.trim())
    .filter(Boolean);
}

function asStringMap(input: unknown): Map<string, string> {
  if (typeof input !== "object" || input === null) {
    return new Map();
  }
  const rows = input as Record<string, unknown>;
  const next = new Map<string, string>();
  for (const [key, value] of Object.entries(rows)) {
    if (typeof value === "string" && value.trim()) {
      next.set(key, value.trim());
    }
  }
  return next;
}

async function readCodexGlobalState(codexHome: string): Promise<{
  workspaceRoots: string[];
  workspaceRootHints: Map<string, string>;
}> {
  const filePath = path.join(codexHome, ".codex-global-state.json");
  try {
    const text = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(text) as CodexGlobalState;
    const electronRoots = asStringArray(parsed["electron-saved-workspace-roots"]);
    const activeRoots = asStringArray(parsed["active-workspace-roots"]);
    const workspaceRoots = electronRoots.length > 0 ? electronRoots : activeRoots;
    const workspaceRootHints = asStringMap(parsed["thread-workspace-root-hints"]);
    return {
      workspaceRoots,
      workspaceRootHints,
    };
  } catch {
    return {
      workspaceRoots: [],
      workspaceRootHints: new Map(),
    };
  }
}

function isInWorkspaceRoots(cwd: string, roots: string[]): boolean {
  if (roots.length === 0) {
    return true;
  }
  return roots.some((root) => isInsidePath(cwd, root));
}

function normalizePath(input: string): string {
  const normalized = path.resolve(input).replaceAll("\\", "/").replace(/\/+$/, "");
  if (process.platform === "win32") {
    return normalized.toLowerCase();
  }
  return normalized;
}

export async function readSessionIndexRows(): Promise<SessionIndexRow[]> {
  const sessionIndexPath = path.join(getCodexHome(), "session_index.jsonl");
  return readJsonl<SessionIndexRow>(sessionIndexPath);
}

export async function writeSessionIndexRows(rows: SessionIndexRow[]): Promise<void> {
  const codexHome = getCodexHome();
  await fs.mkdir(codexHome, { recursive: true });
  const sessionIndexPath = path.join(codexHome, "session_index.jsonl");
  const lines = rows.map((row) => JSON.stringify(row)).join("\n");
  const output = lines ? `${lines}\n` : "";
  await fs.writeFile(sessionIndexPath, output, "utf8");
}

export async function resolveSessionFile(conversationId: string): Promise<{
  filePath: string;
  archived: boolean;
} | null> {
  const codexHome = getCodexHome();
  const activeRoot = path.join(codexHome, "sessions");
  const archivedRoot = path.join(codexHome, "archived_sessions");

  const activeFiles = await listJsonlFiles(activeRoot);
  const activeMatch = activeFiles.find((item) => item.includes(conversationId));
  if (activeMatch) {
    return { filePath: activeMatch, archived: false };
  }

  const archivedFiles = await listJsonlFiles(archivedRoot);
  const archivedMatch = archivedFiles.find((item) => item.includes(conversationId));
  if (archivedMatch) {
    return { filePath: archivedMatch, archived: true };
  }

  return null;
}

export async function readSessionMeta(conversationId: string): Promise<SessionMeta | null> {
  const resolved = await resolveSessionFile(conversationId);
  if (!resolved) {
    return null;
  }

  const lines = await readJsonl<SessionLine>(resolved.filePath);
  const metaLine = lines.find((line) => line.type === "session_meta");
  const payload = metaLine?.payload ?? {};

  const id = asString(payload.id) ?? conversationId;
  const cwd = asString(payload.cwd) ?? null;
  const model = asString(payload.model);

  return {
    id,
    cwd,
    model,
  };
}

export async function createNativeConversation(input: {
  id: string;
  title: string;
  model?: string;
  cwd?: string;
}): Promise<{ filePath: string; archived: boolean }> {
  const codexHome = getCodexHome();
  const now = nowIso();
  const year = now.slice(0, 4);
  const month = now.slice(5, 7);
  const day = now.slice(8, 10);
  const folder = path.join(codexHome, "sessions", year, month, day);
  const filePath = path.join(folder, sessionFileName(input.id));

  await fs.mkdir(folder, { recursive: true });
  await appendJsonl(filePath, {
    timestamp: now,
    type: "session_meta",
    payload: {
      id: input.id,
      timestamp: now,
      cwd: input.cwd ?? process.cwd(),
      originator: "codexmob",
      cli_version: "0.0.0",
      source: "codexmob",
      model_provider: "openai",
      model: input.model,
    },
  });

  const rows = await readSessionIndexRows();
  const next = rows.filter((item) => item.id !== input.id);
  next.push({
    id: input.id,
    thread_name: safeTitle(input.title),
    updated_at: now,
  });
  await writeSessionIndexRows(next);

  return { filePath, archived: false };
}

export async function renameNativeConversation(conversationId: string, title: string): Promise<void> {
  const rows = await readSessionIndexRows();
  const now = nowIso();
  let found = false;
  const next = rows.map((item) => {
    if (item.id !== conversationId) {
      return item;
    }
    found = true;
    return {
      ...item,
      thread_name: safeTitle(title),
      updated_at: now,
    };
  });

  if (!found) {
    next.push({
      id: conversationId,
      thread_name: safeTitle(title),
      updated_at: now,
    });
  }

  await writeSessionIndexRows(next);
}

export async function touchNativeConversation(conversationId: string): Promise<void> {
  const rows = await readSessionIndexRows();
  const now = nowIso();
  let found = false;
  const next = rows.map((item) => {
    if (item.id !== conversationId) {
      return item;
    }
    found = true;
    return {
      ...item,
      updated_at: now,
    };
  });

  if (!found) {
    next.push({
      id: conversationId,
      thread_name: "新会话",
      updated_at: now,
    });
  }

  await writeSessionIndexRows(next);
}

export async function appendNativeMessage(input: {
  conversationId: string;
  role: ChatRole;
  content: string;
  cwd?: string;
}): Promise<void> {
  const resolved = await resolveSessionFile(input.conversationId);
  const session =
    resolved ??
    (await createNativeConversation({
      id: input.conversationId,
      title: input.content.slice(0, 20),
      cwd: input.cwd,
    }));

  const timestamp = nowIso();
  const trimmed = input.content.trim();

  if (input.role === "user") {
    await appendJsonl(session.filePath, {
      timestamp,
      type: "event_msg",
      payload: {
        type: "user_message",
        message: trimmed,
        images: [],
        local_images: [],
        text_elements: [],
      },
    });
  }

  if (input.role === "assistant") {
    await appendJsonl(session.filePath, {
      timestamp,
      type: "event_msg",
      payload: {
        type: "agent_message",
        message: trimmed,
        phase: "final",
      },
    });
  }

  await appendJsonl(session.filePath, {
    timestamp,
    type: "response_item",
    payload: {
      type: "message",
      role: input.role,
      content: [
        {
          type: input.role === "assistant" ? "output_text" : "input_text",
          text: trimmed,
        },
      ],
    },
  });

  await touchNativeConversation(input.conversationId);
}

export async function readCodexHistory(input?: { cwdFilter?: string }): Promise<{
  conversations: HistoryConversation[];
  messages: HistoryMessage[];
}> {
  const codexHome = getCodexHome();
  const targetCwd = input?.cwdFilter ? normalizePath(input.cwdFilter) : "";
  const globalState = await readCodexGlobalState(codexHome);
  const sessionIndexRows = await readSessionIndexRows();
  const sessionIndex = new Map(sessionIndexRows.map((row) => [row.id, row]));
  const visibleIds = new Set(sessionIndexRows.map((row) => row.id));

  const activeRoot = path.join(codexHome, "sessions");
  const activeFiles = await listJsonlFiles(activeRoot);

  const conversations = new Map<string, HistoryConversation>();
  const messages: HistoryMessage[] = [];

  async function readFiles(filePaths: string[], source: SourceKind, archived: boolean) {
    for (const filePath of filePaths) {
      const lines = await readJsonl<SessionLine>(filePath);
      if (lines.length === 0) {
        continue;
      }

      const metaLine = lines.find((line) => line.type === "session_meta");
      const metaPayload = metaLine?.payload ?? {};
      const conversationId = asString(metaPayload.id) ?? path.basename(filePath, ".jsonl");
      const indexRow = sessionIndex.get(conversationId);
      if (!visibleIds.has(conversationId) || !indexRow) {
        continue;
      }
      const metaCwd = asString(metaPayload.cwd);
      const hintedRoot = globalState.workspaceRootHints.get(conversationId);
      const effectiveCwd = metaCwd ?? hintedRoot;
      if (!(await isRealWorkspaceCwd(effectiveCwd, codexHome))) {
        continue;
      }
      if (targetCwd && (!effectiveCwd || normalizePath(effectiveCwd) !== targetCwd)) {
        continue;
      }
      if (!effectiveCwd || !isInWorkspaceRoots(effectiveCwd, globalState.workspaceRoots)) {
        continue;
      }
      const updatedAt =
        indexRow.updated_at ??
        asString(metaPayload.timestamp) ??
        asString(metaLine?.timestamp) ??
        nowIso();

      const conversation: HistoryConversation = {
        id: conversationId,
        title: safeTitle(indexRow.thread_name),
        updatedAt,
        source,
        cwd: effectiveCwd,
        archived,
        model: asString(metaPayload.model),
      };
      conversations.set(conversationId, conversation);

      for (const line of lines) {
        if (line.type !== "response_item" || !line.payload) {
          continue;
        }
        if (asString(line.payload.type) !== "message") {
          continue;
        }

        const role = normalizeRole(asString(line.payload.role));
        if (!role || role === "system") {
          continue;
        }

        const content = extractMessageText(line.payload);
        if (!content) {
          continue;
        }
        if (!isVisibleChatMessage(role, content)) {
          continue;
        }

        messages.push({
          id: `${conversationId}-${messages.length + 1}`,
          conversationId,
          role,
          content,
          createdAt: asString(line.timestamp) ?? updatedAt,
          source,
        });
      }
    }
  }

  await readFiles(activeFiles, "codex_active", false);

  const conversationRows = Array.from(conversations.values()).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  const messageRows = messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return {
    conversations: conversationRows,
    messages: messageRows,
  };
}
