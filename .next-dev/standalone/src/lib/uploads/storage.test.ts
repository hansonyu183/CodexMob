import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import {
  bindUploadsToConversation,
  classifyUpload,
  getUploadById,
  listUploadsByConversationId,
  persistUploadedFile,
} from "@/lib/uploads/storage";

const cleanupDirs = new Set<string>();

afterEach(async () => {
  for (const dir of cleanupDirs) {
    await fs.rm(dir, { recursive: true, force: true });
  }
  cleanupDirs.clear();
  delete process.env.CODEX_HOME;
});

describe("classifyUpload", () => {
  it("classifies image extensions", () => {
    expect(classifyUpload("demo.png", "")).toBe("image");
    expect(classifyUpload("demo.jpeg", "")).toBe("image");
  });

  it("classifies text extensions and mime", () => {
    expect(classifyUpload("notes.md", "")).toBe("text");
    expect(classifyUpload("unknown.bin", "text/plain")).toBe("text");
  });

  it("rejects unsupported files", () => {
    expect(classifyUpload("archive.zip", "application/zip")).toBeNull();
  });

  it("persists, binds and retrieves uploads by conversation", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "codexmob-upload-"));
    cleanupDirs.add(home);
    process.env.CODEX_HOME = path.join(home, ".codex");
    await fs.mkdir(process.env.CODEX_HOME, { recursive: true });

    const item = await persistUploadedFile({
      fileName: "notes.md",
      mimeType: "text/markdown",
      bytes: new TextEncoder().encode("hello"),
      scope: "temp",
    });

    expect(item.id.length).toBeGreaterThan(0);

    await bindUploadsToConversation([item.id], "conv-1");
    const rows = await listUploadsByConversationId("conv-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(item.id);

    const found = await getUploadById(item.id);
    expect(found?.path).toBe(item.path);
  });
});
