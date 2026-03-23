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

  const codexHome = getCodexHome();
  const bucket = sanitizeName(input.scope || "temp");
  const uploadsRoot = path.join(codexHome, "..", ".codexmob", "uploads", bucket);
  await fs.mkdir(uploadsRoot, { recursive: true });

  const safeName = sanitizeName(input.fileName);
  const id = nanoid();
  const filePath = path.join(uploadsRoot, `${id}-${safeName}`);
  await fs.writeFile(filePath, input.bytes);

  return {
    id,
    name: safeName,
    path: filePath,
    kind,
    size: input.bytes.byteLength,
  };
}

