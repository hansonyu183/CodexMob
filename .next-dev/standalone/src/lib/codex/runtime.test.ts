import { describe, expect, it } from "vitest";

import {
  buildExecArgsForTests,
  buildExecResumeArgsForTests,
  parseAuthStatusForTests,
} from "@/lib/codex/runtime";

describe("parseAuthStatusForTests", () => {
  it("parses chatgpt login status", () => {
    const result = parseAuthStatusForTests("Logged in using ChatGPT");
    expect(result).toEqual({
      ready: true,
      loginMethod: "chatgpt",
      message: "Logged in with ChatGPT.",
    });
  });

  it("parses not logged in status", () => {
    const result = parseAuthStatusForTests("Not logged in");
    expect(result.ready).toBe(false);
    expect(result.loginMethod).toBe("none");
  });

  it("builds exec args with sandbox at exec level", () => {
    const args = buildExecArgsForTests({
      sandbox: "read-only",
      model: "gpt-5.4",
      message: "hello",
    });
    expect(args).toEqual([
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--json",
      "--model",
      "gpt-5.4",
      "hello",
    ]);
  });

  it("builds exec resume args with sandbox before resume", () => {
    const args = buildExecResumeArgsForTests({
      sandbox: "read-only",
      model: "gpt-5.4",
      conversationId: "c1",
      message: "hello again",
    });
    expect(args).toEqual([
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "resume",
      "--json",
      "--model",
      "gpt-5.4",
      "c1",
      "hello again",
    ]);
  });
});
