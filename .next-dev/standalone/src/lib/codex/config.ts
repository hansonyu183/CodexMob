import path from "node:path";
import { promises as fs, readFileSync } from "node:fs";

import { getCodexHome } from "@/lib/history/paths";

const FALLBACK_MODELS = [
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "gpt-5.2-codex",
  "gpt-5.2",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex-mini",
];

export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";

function parseTomlStringValue(input: string, key: string): string | null {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const doubleQuoted = new RegExp(`^\\s*${escapedKey}\\s*=\\s*"([^"]+)"\\s*$`, "m");
  const singleQuoted = new RegExp(`^\\s*${escapedKey}\\s*=\\s*'([^']+)'\\s*$`, "m");
  const raw = new RegExp(`^\\s*${escapedKey}\\s*=\\s*([^\\s#]+)`, "m");

  const matchedDouble = input.match(doubleQuoted);
  if (matchedDouble?.[1]?.trim()) {
    return matchedDouble[1].trim();
  }

  const matchedSingle = input.match(singleQuoted);
  if (matchedSingle?.[1]?.trim()) {
    return matchedSingle[1].trim();
  }

  const matchedRaw = input.match(raw);
  if (matchedRaw?.[1]?.trim()) {
    return matchedRaw[1].trim();
  }

  return null;
}

function parseTomlSectionStringValue(
  input: string,
  section: string,
  key: string,
): string | null {
  const escapedSection = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sectionRegex = new RegExp(
    `^\\s*\\[\\s*${escapedSection}\\s*\\]\\s*$([\\s\\S]*?)(?=^\\s*\\[|\\Z)`,
    "m",
  );
  const matched = input.match(sectionRegex);
  if (!matched?.[1]) {
    return null;
  }
  return parseTomlStringValue(matched[1], key);
}

function normalizeSandbox(input: string | null | undefined): CodexSandboxMode | null {
  if (!input) {
    return null;
  }
  const normalized = input.trim().toLowerCase();
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

export async function getLocalDefaultModel(): Promise<string | null> {
  const codexHome = getCodexHome();
  const configPath = path.join(codexHome, "config.toml");

  try {
    const content = await fs.readFile(configPath, "utf8");
    return parseTomlStringValue(content, "model");
  } catch {
    return null;
  }
}

function parseTomlSandbox(input: string): CodexSandboxMode | null {
  const fromWindows = parseTomlSectionStringValue(input, "windows", "sandbox");
  const fromRoot = parseTomlStringValue(input, "sandbox");
  return normalizeSandbox(fromWindows ?? fromRoot);
}

export function getLocalSandboxModeSync(): CodexSandboxMode | null {
  const codexHome = getCodexHome();
  const configPath = path.join(codexHome, "config.toml");

  try {
    const content = readFileSync(configPath, "utf8");
    return parseTomlSandbox(content);
  } catch {
    return null;
  }
}

function parseTomlModelList(input: string): string[] {
  const regex = /^\s*model\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s#]+))/gm;
  const models: string[] = [];

  for (const match of input.matchAll(regex)) {
    const model = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!model) {
      continue;
    }
    models.push(model);
  }

  return Array.from(new Set(models));
}

interface CachedModel {
  slug?: string;
  visibility?: string;
  priority?: number;
}

interface ModelsCacheFile {
  models?: CachedModel[];
}

function parseModelsCacheContent(input: string): string[] {
  try {
    const parsed = JSON.parse(input) as ModelsCacheFile;
    const models = Array.isArray(parsed.models) ? parsed.models : [];

    const visible = models
      .filter((entry) => entry?.visibility === "list" && typeof entry.slug === "string" && entry.slug.trim())
      .map((entry) => ({
        slug: entry.slug!.trim(),
        priority: Number.isFinite(entry.priority) ? Number(entry.priority) : Number.MAX_SAFE_INTEGER,
      }))
      .sort((left, right) => left.priority - right.priority)
      .map((entry) => entry.slug);

    return Array.from(new Set(visible));
  } catch {
    return [];
  }
}

export async function getLocalModelConfig(): Promise<{
  defaultModel: string | null;
  models: string[];
}> {
  const codexHome = getCodexHome();
  const configPath = path.join(codexHome, "config.toml");
  const modelsCachePath = path.join(codexHome, "models_cache.json");

  try {
    const [configContent, cacheContent] = await Promise.all([
      fs.readFile(configPath, "utf8"),
      fs.readFile(modelsCachePath, "utf8").catch(() => ""),
    ]);

    const defaultModel = parseTomlStringValue(configContent, "model");
    const cacheModels = parseModelsCacheContent(cacheContent);
    const models = cacheModels.length > 0 ? cacheModels : FALLBACK_MODELS;

    const merged = Array.from(new Set([...(defaultModel ? [defaultModel] : []), ...models]));

    return {
      defaultModel,
      models: merged,
    };
  } catch {
    return {
      defaultModel: null,
      models: [...FALLBACK_MODELS],
    };
  }
}

export function parseTomlModelForTests(input: string): string | null {
  return parseTomlStringValue(input, "model");
}

export function parseTomlModelListForTests(input: string): string[] {
  return parseTomlModelList(input);
}

export function parseModelsCacheForTests(input: string): string[] {
  return parseModelsCacheContent(input);
}

export function parseTomlSandboxForTests(input: string): CodexSandboxMode | null {
  return parseTomlSandbox(input);
}

export function normalizeSandboxForTests(input: string | null | undefined): CodexSandboxMode | null {
  return normalizeSandbox(input);
}
