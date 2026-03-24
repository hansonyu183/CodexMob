import { describe, expect, it } from "vitest";

import {
  buildExecArgsForTests,
  buildExecResumeArgsForTests,
  buildSandboxAndApprovalArgsForTests,
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

  it("builds exec args for read-only mode", () => {
    const args = buildExecArgsForTests({
      sandbox: "read-only",
      model: "gpt-5.4",
    });
    expect(args).toEqual([
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--json",
      "--model",
      "gpt-5.4",
      "-",
    ]);
  });

  it("builds exec resume args with sandbox before resume", () => {
    const args = buildExecResumeArgsForTests({
      sandbox: "read-only",
      model: "gpt-5.4",
      conversationId: "c1",
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
      "-",
    ]);
  });

  it("builds exec args with full-auto for workspace-write", () => {
    const args = buildExecArgsForTests({
      sandbox: "workspace-write",
      model: "gpt-5.4",
    });
    expect(args).toEqual([
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "workspace-write",
      "--full-auto",
      "--json",
      "--model",
      "gpt-5.4",
      "-",
    ]);
  });

  it("builds exec args with bypass flag for danger-full-access", () => {
    const args = buildExecArgsForTests({
      sandbox: "danger-full-access",
      model: "gpt-5.4",
    });
    expect(args).toEqual([
      "exec",
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      "--json",
      "--model",
      "gpt-5.4",
      "-",
    ]);
  });

  it("exposes policy mode mapping", () => {
    expect(buildSandboxAndApprovalArgsForTests("read-only").policyMode).toBe("read_only");
    expect(buildSandboxAndApprovalArgsForTests("workspace-write").policyMode).toBe("full_auto");
    expect(buildSandboxAndApprovalArgsForTests("danger-full-access").policyMode).toBe("bypass_all");
  });
});
