import path from "node:path";
import { promises as fs } from "node:fs";

import { nanoid } from "nanoid";

import type { UploadItem } from "@/lib/types";
import { getCodexHome } from "@/lib/history/paths";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".json",
  ".yaml",
  ".yml",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".css",
  ".html",
  ".sh",
  ".ps1",
  ".sql",
  ".log",
]);

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const INDEX_FILE = "index.json";

interface UploadRecord extends UploadItem {
  scope: string;
  createdAt: string;
  conversationId?: string;
}

interface UploadIndexFile {
  items: UploadRecord[];
}

function sanitizeName(input: string): string {
  const fallback = "file";
  const trimmed = input.trim();
  if (!trimmed) {
    return fallback;
  }
  const base = path.basename(trimmed);
  const safe = base.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
  return safe || fallback;
}

function getUploadsRootDir(): string {
  const codexHome = getCodexHome();
  return path.join(codexHome, "..", ".codexmob", "uploads");
}

function isLikelyInsideRoot(filePath: string, root: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(filePath);
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`);
}

async function readUploadIndex(): Promise<UploadIndexFile> {
  const uploadsRoot = getUploadsRootDir();
  const indexPath = path.join(uploadsRoot, INDEX_FILE);

  try {
    const content = await fs.readFile(indexPath, "utf8");
    const parsed = JSON.parse(content) as Partial<UploadIndexFile>;
    if (!Array.isArray(parsed.items)) {
      return { items: [] };
    }

    const items = parsed.items.filter((item): item is UploadRecord => (
      typeof item === "object" &&
      item !== null &&
      typeof item.id === "string" &&
      typeof item.name === "string" &&
      typeof item.path === "string" &&
      typeof item.kind === "string" &&
      typeof item.size === "number" &&
      typeof item.scope === "string" &&
      typeof item.createdAt === "string"
    ));

    return { items };
  } catch {
    return { items: [] };
  }
}

async function writeUploadIndex(index: UploadIndexFile): Promise<void> {
  const uploadsRoot = getUploadsRootDir();
  const indexPath = path.join(uploadsRoot, INDEX_FILE);
  await fs.mkdir(uploadsRoot, { recursive: true });
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2), "utf8");
}

export function classifyUpload(fileName: string, mimeType: string): "image" | "text" | null {
  const extension = path.extname(fileName).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }
  if (TEXT_EXTENSIONS.has(extension) || mimeType.startsWith("text/")) {
    return "text";
  }
  return null;
}

export async function persistUploadedFile(input: {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  scope: string;
}): Promise<UploadItem> {
  if (input.bytes.byteLength <= 0) {
    throw new Error("文件为空。");
  }
  if (input.bytes.byteLength > MAX_FILE_SIZE_BYTES) {
    throw new Error("文件超过 10MB 限制。");
  }

  const kind = classifyUpload(input.fileName, input.mimeType);
  if (!kind) {
    throw new Error("仅支持图片和文本文件。");
  }

  const bucket = sanitizeName(input.scope || "temp");
  const uploadsRoot = getUploadsRootDir();
  const bucketDir = path.join(uploadsRoot, bucket);
  await fs.mkdir(bucketDir, { recursive: true });

  const safeName = sanitizeName(input.fileName);
  const id = nanoid();
  const filePath = path.join(bucketDir, `${id}-${safeName}`);
  await fs.writeFile(filePath, input.bytes);

  const item: UploadItem = {
    id,
    name: safeName,
    path: filePath,
    kind,
    size: input.bytes.byteLength,
  };

  const index = await readUploadIndex();
  const nextItems = index.items.filter((row) => row.id !== id);
  nextItems.push({
    ...item,
    scope: input.scope,
    createdAt: new Date().toISOString(),
  });
  await writeUploadIndex({ items: nextItems });

  return item;
}

export async function bindUploadsToConversation(
  uploadIds: string[],
  conversationId: string,
): Promise<void> {
  if (uploadIds.length === 0 || !conversationId.trim()) {
    return;
  }

  const targets = new Set(uploadIds.map((item) => item.trim()).filter(Boolean));
  if (targets.size === 0) {
    return;
  }

  const index = await readUploadIndex();
  let changed = false;
  const items = index.items.map((row) => {
    if (!targets.has(row.id)) {
      return row;
    }
    if (row.conversationId === conversationId) {
      return row;
    }
    changed = true;
    return {
      ...row,
      conversationId,
    };
  });

  if (changed) {
    await writeUploadIndex({ items });
  }
}

export async function listUploadsByConversationId(conversationId: string): Promise<UploadItem[]> {
  if (!conversationId.trim()) {
    return [];
  }

  const index = await readUploadIndex();
  return index.items
    .filter((row) => row.conversationId === conversationId)
    .map(({ id, name, path: rowPath, kind, size }) => ({ id, name, path: rowPath, kind, size }));
}

export async function getUploadById(id: string): Promise<UploadItem | null> {
  const trimmed = id.trim();
  if (!trimmed) {
    return null;
  }

  const index = await readUploadIndex();
  const found = index.items.find((row) => row.id === trimmed);
  if (!found) {
    return null;
  }

  const uploadsRoot = getUploadsRootDir();
  if (!isLikelyInsideRoot(found.path, uploadsRoot)) {
    return null;
  }

  try {
    const stat = await fs.stat(found.path);
    if (!stat.isFile()) {
      return null;
    }
  } catch {
    return null;
  }

  return {
    id: found.id,
    name: found.name,
    path: found.path,
    kind: found.kind,
    size: found.size,
  };
}
