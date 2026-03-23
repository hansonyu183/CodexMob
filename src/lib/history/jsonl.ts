import { promises as fs } from "node:fs";

export async function readJsonl<T>(filePath: string): Promise<T[]> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const lines = content.split(/\r?\n/).filter(Boolean);
    const parsed: T[] = [];
    for (const line of lines) {
      try {
        parsed.push(JSON.parse(line) as T);
      } catch {
        // Skip malformed line
      }
    }
    return parsed;
  } catch {
    return [];
  }
}

export async function appendJsonl(filePath: string, row: unknown): Promise<void> {
  const line = `${JSON.stringify(row)}\n`;
  await fs.appendFile(filePath, line, "utf8");
}

