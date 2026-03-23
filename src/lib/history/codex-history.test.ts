import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { readCodexHistory } from "@/lib/history/codex-history";

async function writeJsonl(filePath: string, rows: unknown[]) {
  const content = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

describe("readCodexHistory", () => {
  let tempDir = "";
  let previousCodexHome: string | undefined;

  afterEach(async () => {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("hides sessions that are not present in session_index", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codexmob-history-"));
    previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = tempDir;

    const visibleId = "visible-1";
    const hiddenId = "hidden-1";
    const visibleCwd = path.join(tempDir, "repo", "visible");
    await fs.mkdir(visibleCwd, { recursive: true });

    await writeJsonl(path.join(tempDir, "session_index.jsonl"), [
      {
        id: visibleId,
        thread_name: "Visible Session",
        updated_at: "2026-03-22T12:00:00.000Z",
      },
    ]);

    await writeJsonl(
      path.join(tempDir, "sessions", "2026", "03", "22", `rollout-${visibleId}.jsonl`),
      [
        {
          timestamp: "2026-03-22T11:59:00.000Z",
          type: "session_meta",
          payload: { id: visibleId, cwd: visibleCwd, model: "gpt-5.4" },
        },
        {
          timestamp: "2026-03-22T12:00:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "hello visible" }],
          },
        },
      ],
    );

    await writeJsonl(
      path.join(tempDir, "sessions", "2026", "03", "22", `rollout-${hiddenId}.jsonl`),
      [
        {
          timestamp: "2026-03-22T12:01:00.000Z",
          type: "session_meta",
          payload: { id: hiddenId, cwd: "D:\\code\\B", model: "gpt-5.4" },
        },
        {
          timestamp: "2026-03-22T12:02:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "hello hidden" }],
          },
        },
      ],
    );

    const history = await readCodexHistory();
    expect(history.conversations.map((item) => item.id)).toEqual([visibleId]);
    expect(history.messages.map((item) => item.conversationId)).toEqual([visibleId]);
  });

  it("shows only real workspaces and hides worktrees/missing cwd/missing path", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codexmob-history-real-"));
    previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = tempDir;

    const visibleId = "real-1";
    const worktreeId = "wt-1";
    const missingCwdId = "nocwd-1";
    const missingPathId = "gone-1";
    const visibleCwd = path.join(tempDir, "repo", "CodexMob");
    const worktreeCwd = path.join(tempDir, "worktrees", "30b0", "AgentOS");
    const missingPathCwd = path.join(tempDir, "deleted", "AgentOS");

    await fs.mkdir(visibleCwd, { recursive: true });
    await fs.mkdir(worktreeCwd, { recursive: true });

    await writeJsonl(path.join(tempDir, "session_index.jsonl"), [
      { id: visibleId, thread_name: "Visible", updated_at: "2026-03-22T12:00:00.000Z" },
      { id: worktreeId, thread_name: "Worktree", updated_at: "2026-03-22T12:01:00.000Z" },
      { id: missingCwdId, thread_name: "NoCwd", updated_at: "2026-03-22T12:02:00.000Z" },
      { id: missingPathId, thread_name: "MissingPath", updated_at: "2026-03-22T12:03:00.000Z" },
    ]);

    await writeJsonl(
      path.join(tempDir, "sessions", "2026", "03", "22", `rollout-${visibleId}.jsonl`),
      [
        {
          timestamp: "2026-03-22T11:59:00.000Z",
          type: "session_meta",
          payload: { id: visibleId, cwd: visibleCwd, model: "gpt-5.4" },
        },
      ],
    );
    await writeJsonl(
      path.join(tempDir, "sessions", "2026", "03", "22", `rollout-${worktreeId}.jsonl`),
      [
        {
          timestamp: "2026-03-22T11:59:00.000Z",
          type: "session_meta",
          payload: { id: worktreeId, cwd: worktreeCwd, model: "gpt-5.4" },
        },
      ],
    );
    await writeJsonl(
      path.join(tempDir, "sessions", "2026", "03", "22", `rollout-${missingCwdId}.jsonl`),
      [
        {
          timestamp: "2026-03-22T11:59:00.000Z",
          type: "session_meta",
          payload: { id: missingCwdId, model: "gpt-5.4" },
        },
      ],
    );
    await writeJsonl(
      path.join(tempDir, "sessions", "2026", "03", "22", `rollout-${missingPathId}.jsonl`),
      [
        {
          timestamp: "2026-03-22T11:59:00.000Z",
          type: "session_meta",
          payload: { id: missingPathId, cwd: missingPathCwd, model: "gpt-5.4" },
        },
      ],
    );

    const history = await readCodexHistory();
    expect(history.conversations.map((item) => item.id)).toEqual([visibleId]);
  });

  it("hides archived sessions by default", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codexmob-history-archived-"));
    previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = tempDir;

    const archivedId = "archived-1";
    const archivedCwd = path.join(tempDir, "repo", "AgentOS");
    await fs.mkdir(archivedCwd, { recursive: true });

    await writeJsonl(path.join(tempDir, "session_index.jsonl"), [
      {
        id: archivedId,
        thread_name: "Archived Session",
        updated_at: "2026-03-22T12:00:00.000Z",
      },
    ]);

    await writeJsonl(
      path.join(tempDir, "archived_sessions", `rollout-${archivedId}.jsonl`),
      [
        {
          timestamp: "2026-03-22T11:59:00.000Z",
          type: "session_meta",
          payload: { id: archivedId, cwd: archivedCwd, model: "gpt-5.4" },
        },
      ],
    );

    const history = await readCodexHistory();
    expect(history.conversations).toHaveLength(0);
  });

  it("applies codex workspace root whitelist from global state", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codexmob-history-roots-"));
    previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = tempDir;

    const visibleId = "root-allow-1";
    const hiddenId = "root-hide-1";
    const visibleRoot = path.join(tempDir, "allowed-root");
    const hiddenRoot = path.join(tempDir, "other-root");
    await fs.mkdir(path.join(visibleRoot, "repo"), { recursive: true });
    await fs.mkdir(path.join(hiddenRoot, "repo"), { recursive: true });

    await fs.writeFile(
      path.join(tempDir, ".codex-global-state.json"),
      JSON.stringify({
        "electron-saved-workspace-roots": [visibleRoot],
      }),
      "utf8",
    );

    await writeJsonl(path.join(tempDir, "session_index.jsonl"), [
      { id: visibleId, thread_name: "Visible", updated_at: "2026-03-22T12:00:00.000Z" },
      { id: hiddenId, thread_name: "Hidden", updated_at: "2026-03-22T12:01:00.000Z" },
    ]);

    await writeJsonl(
      path.join(tempDir, "sessions", "2026", "03", "22", `rollout-${visibleId}.jsonl`),
      [
        {
          timestamp: "2026-03-22T11:59:00.000Z",
          type: "session_meta",
          payload: { id: visibleId, cwd: path.join(visibleRoot, "repo"), model: "gpt-5.4" },
        },
      ],
    );
    await writeJsonl(
      path.join(tempDir, "sessions", "2026", "03", "22", `rollout-${hiddenId}.jsonl`),
      [
        {
          timestamp: "2026-03-22T11:59:00.000Z",
          type: "session_meta",
          payload: { id: hiddenId, cwd: path.join(hiddenRoot, "repo"), model: "gpt-5.4" },
        },
      ],
    );

    const history = await readCodexHistory();
    expect(history.conversations.map((item) => item.id)).toEqual([visibleId]);
  });

  it("filters injected AGENTS/environment context while preserving real messages", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codexmob-history-injected-"));
    previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = tempDir;

    const id = "inject-filter-1";
    const cwd = path.join(tempDir, "repo", "CodexMob");
    await fs.mkdir(cwd, { recursive: true });

    await writeJsonl(path.join(tempDir, "session_index.jsonl"), [
      { id, thread_name: "Visible", updated_at: "2026-03-22T12:00:00.000Z" },
    ]);

    await writeJsonl(path.join(tempDir, "sessions", "2026", "03", "22", `rollout-${id}.jsonl`), [
      {
        timestamp: "2026-03-22T11:58:00.000Z",
        type: "session_meta",
        payload: { id, cwd, model: "gpt-5.4" },
      },
      {
        timestamp: "2026-03-22T11:59:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "# AGENTS.md instructions for D:\\code\\CodexMob\n\n<INSTRUCTIONS>\n...",
            },
          ],
        },
      },
      {
        timestamp: "2026-03-22T11:59:30.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "<environment_context>\n  <cwd>D:\\code\\CodexMob</cwd>" }],
        },
      },
      {
        timestamp: "2026-03-22T12:00:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "真实问题：请帮我修复按钮点击无效" }],
        },
      },
      {
        timestamp: "2026-03-22T12:01:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "已定位 service worker 缓存问题。" }],
        },
      },
    ]);

    const history = await readCodexHistory();
    expect(history.conversations.map((item) => item.id)).toEqual([id]);
    expect(history.messages.map((item) => item.role)).toEqual(["user", "assistant"]);
    expect(history.messages.map((item) => item.content)).toEqual([
      "真实问题：请帮我修复按钮点击无效",
      "已定位 service worker 缓存问题。",
    ]);
  });

  it("supports cwdFilter to return only target project conversations", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codexmob-history-cwd-filter-"));
    previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = tempDir;

    const keepId = "keep-1";
    const skipId = "skip-1";
    const keepCwd = path.join(tempDir, "repo", "skills-dev");
    const skipCwd = path.join(tempDir, "repo", "CodexMob");
    await fs.mkdir(keepCwd, { recursive: true });
    await fs.mkdir(skipCwd, { recursive: true });

    await writeJsonl(path.join(tempDir, "session_index.jsonl"), [
      { id: keepId, thread_name: "keep", updated_at: "2026-03-22T12:00:00.000Z" },
      { id: skipId, thread_name: "skip", updated_at: "2026-03-22T12:01:00.000Z" },
    ]);

    await writeJsonl(path.join(tempDir, "sessions", "2026", "03", "22", `rollout-${keepId}.jsonl`), [
      {
        timestamp: "2026-03-22T11:58:00.000Z",
        type: "session_meta",
        payload: { id: keepId, cwd: keepCwd, model: "gpt-5.4" },
      },
      {
        timestamp: "2026-03-22T12:00:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "hello keep" }],
        },
      },
    ]);

    await writeJsonl(path.join(tempDir, "sessions", "2026", "03", "22", `rollout-${skipId}.jsonl`), [
      {
        timestamp: "2026-03-22T11:58:00.000Z",
        type: "session_meta",
        payload: { id: skipId, cwd: skipCwd, model: "gpt-5.4" },
      },
      {
        timestamp: "2026-03-22T12:00:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "hello skip" }],
        },
      },
    ]);

    const history = await readCodexHistory({ cwdFilter: keepCwd });
    expect(history.conversations.map((item) => item.id)).toEqual([keepId]);
    expect(history.messages.map((item) => item.conversationId)).toEqual([keepId]);
  });
});
