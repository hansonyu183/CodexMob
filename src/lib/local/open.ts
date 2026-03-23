import path from "node:path";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";

const HTTP_LIKE = /^[a-z]+:\/\//i;
const WINDOWS_DRIVE = /^[A-Za-z]:/;
const UNC_ABS = /^\\\\[^\\]+\\[^\\]+/;

export function normalizeLocalAbsolutePath(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  if (HTTP_LIKE.test(trimmed) || trimmed.startsWith("file://")) {
    return null;
  }
  if (trimmed.includes("\0")) {
    return null;
  }

  let normalized = trimmed;
  if (WINDOWS_DRIVE.test(trimmed) && !/^[A-Za-z]:[\\/]/.test(trimmed)) {
    normalized = `${trimmed.slice(0, 2)}\\${trimmed.slice(2)}`;
  }
  normalized = path.normalize(normalized);
  const isWindowsAbsolute =
    process.platform === "win32"
      ? WINDOWS_DRIVE.test(normalized) || UNC_ABS.test(normalized)
      : path.isAbsolute(normalized);

  if (!isWindowsAbsolute) {
    return null;
  }

  if (/^[A-Za-z]:\\?$/.test(normalized)) {
    return null;
  }

  return normalized;
}

export async function openLocalPathInSystem(input: string): Promise<void> {
  const normalized = normalizeLocalAbsolutePath(input);
  if (!normalized) {
    throw new Error("Invalid local absolute path.");
  }

  await fs.access(normalized);

  await new Promise<void>((resolve, reject) => {
    const command =
      process.platform === "win32"
        ? "explorer.exe"
        : process.platform === "darwin"
          ? "open"
          : "xdg-open";

    const child = spawn(command, [normalized], {
      detached: true,
      stdio: "ignore",
    });

    child.once("error", reject);
    child.unref();
    resolve();
  });
}
