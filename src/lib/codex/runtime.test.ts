import { describe, expect, it } from "vitest";

import {
  buildPromptForTests,
  buildExecArgsForTests,
  buildExecResumeArgsForTests,
  buildSandboxAndApprovalArgsForTests,
  getInjectionProfileForTests,
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

  it("builds plan prompt with plan-mode instruction block before user input", () => {
    const prompt = buildPromptForTests({
      mode: "plan",
      message: "用户问题",
      textAttachments: [],
    });

    expect(prompt).toContain("# Plan Mode (Conversational)");
    expect(prompt.indexOf("# Plan Mode (Conversational)")).toBeLessThan(prompt.indexOf("用户问题"));
  });

  it("keeps attachments section after plan instructions and before message", () => {
    const prompt = buildPromptForTests({
      mode: "plan",
      message: "请总结",
      textAttachments: [
        {
          id: "u1",
          name: "a.txt",
          path: "D:\\code\\a.txt",
          kind: "text",
          size: 12,
        },
      ],
    });

    const planPos = prompt.indexOf("# Plan Mode (Conversational)");
    const attachmentPos = prompt.indexOf("已上传文本文件如下，请按需读取并引用：");
    const messagePos = prompt.lastIndexOf("请总结");

    expect(planPos).toBeGreaterThanOrEqual(0);
    expect(attachmentPos).toBeGreaterThan(planPos);
    expect(messagePos).toBeGreaterThan(attachmentPos);
  });

  it("maps injection profile by mode", () => {
    expect(getInjectionProfileForTests("plan")).toBe("plan_v1");
    expect(getInjectionProfileForTests("default")).toBe("default_v1");
    expect(getInjectionProfileForTests(undefined)).toBe("default_v1");
  });
});
