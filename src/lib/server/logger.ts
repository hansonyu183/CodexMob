import path from "node:path";
import { promises as fs } from "node:fs";

export interface FileLoggerOptions {
  filePath: string;
  maxFieldChars: number;
}

export interface LogEntry {
  ts: string;
  type: string;
  requestId: string;
  [key: string]: unknown;
}

function truncateString(input: string, maxFieldChars: number): string {
  if (input.length <= maxFieldChars) {
    return input;
  }
  return `${input.slice(0, maxFieldChars)}...`;
}

function sanitizeValue(input: unknown, maxFieldChars: number): unknown {
  if (typeof input === "string") {
    return truncateString(input, maxFieldChars);
  }
  if (Array.isArray(input)) {
    return input.map((item) => sanitizeValue(item, maxFieldChars));
  }
  if (input && typeof input === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      next[key] = sanitizeValue(value, maxFieldChars);
    }
    return next;
  }
  return input;
}

export class FileLogger {
  constructor(private readonly options: FileLoggerOptions) {}

  async log(entry: LogEntry): Promise<void> {
    if (!this.options.filePath.trim()) {
      return;
    }
    const resolved = path.isAbsolute(this.options.filePath)
      ? this.options.filePath
      : path.resolve(process.cwd(), this.options.filePath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    const row = {
      ...entry,
      ts: entry.ts,
      type: entry.type,
      requestId: entry.requestId,
    } as Record<string, unknown>;
    for (const [key, value] of Object.entries(entry)) {
      if (key === "ts" || key === "type" || key === "requestId") {
        continue;
      }
      row[key] = sanitizeValue(value, this.options.maxFieldChars);
    }
    await fs.appendFile(resolved, `${JSON.stringify(row)}\n`, "utf8");
  }
}
