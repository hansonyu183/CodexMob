import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { FileLogger } from "@/lib/server/logger";

describe("FileLogger", () => {
  let tempDir = "";

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("writes jsonl rows and truncates long fields", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codexmob-logger-"));
    const logFile = path.join(tempDir, "logs", "chat-stream.jsonl");
    const logger = new FileLogger({
      filePath: logFile,
      maxFieldChars: 8,
    });

    await logger.log({
      ts: "2026-03-23T00:00:00.000Z",
      type: "request_received",
      requestId: "req-1",
      inputPreview: "0123456789abcdef",
    });

    const content = await fs.readFile(logFile, "utf8");
    const lines = content.trim().split(/\r?\n/);
    expect(lines).toHaveLength(1);
    const row = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(row.type).toBe("request_received");
    expect(row.inputPreview).toBe("01234567...");
  });
});
