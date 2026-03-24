import { getLocalSandboxModeSync, type CodexSandboxMode } from "@/lib/codex/config";

const DEFAULT_MODELS = ["gpt-5.4", "gpt-5.3-codex", "gpt-5.2"];

function parseCsv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function resolveSandboxMode(value: string | undefined): CodexSandboxMode | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "read-only" || normalized === "readonly" || normalized === "read_only") {
    return "read-only";
  }
  if (
    normalized === "workspace-write" ||
    normalized === "workspace_write" ||
    normalized === "workspace" ||
    normalized === "write"
  ) {
    return "workspace-write";
  }
  if (
    normalized === "danger-full-access" ||
    normalized === "danger_full_access" ||
    normalized === "danger" ||
    normalized === "full-access" ||
    normalized === "full" ||
    normalized === "elevated"
  ) {
    return "danger-full-access";
  }
  return null;
}

function resolveCodexSandbox(): CodexSandboxMode {
  const fromEnv = resolveSandboxMode(process.env.CODEX_SANDBOX);
  if (fromEnv) {
    return fromEnv;
  }
  const fromLocal = getLocalSandboxModeSync();
  if (fromLocal) {
    return fromLocal;
  }
  return "read-only";
}

export const serverEnv = {
  appAccessCode: process.env.APP_ACCESS_CODE ?? "",
  codexHome: process.env.CODEX_HOME ?? "",
  defaultModel: process.env.DEFAULT_MODEL ?? DEFAULT_MODELS[0],
  allowedModels: parseCsv(process.env.ALLOWED_MODELS),
  codexBin: process.env.CODEX_BIN ?? "codex",
  codexSandbox: resolveCodexSandbox(),
  codexCwd: process.env.CODEX_CWD || process.cwd(),
  codexExecTimeoutMs: parsePositiveInteger(process.env.CODEX_EXEC_TIMEOUT_MS, 30000),
  codexMobLogFile: process.env.CODEXMOB_LOG_FILE ?? "",
  codexMobLogMaxFieldChars: parsePositiveInteger(process.env.CODEXMOB_LOG_MAX_FIELD_CHARS, 500),
  rateLimitWindowMs: parsePositiveInteger(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
  rateLimitMax: parsePositiveInteger(process.env.RATE_LIMIT_MAX, 30),
};

export function resolveModels(): string[] {
  const merged = [
    ...serverEnv.allowedModels,
    serverEnv.defaultModel,
    ...DEFAULT_MODELS,
  ].filter(Boolean);
  return Array.from(new Set(merged));
}
