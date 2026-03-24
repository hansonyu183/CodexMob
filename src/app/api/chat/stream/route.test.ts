import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetPlanSessionsForTests } from "@/lib/plan/state";

const getAuthStatus = vi.fn();
const streamNewSession = vi.fn();
const streamResumeSession = vi.fn();
const limiterCheck = vi.fn();
const getConversationMeta = vi.fn();
const listSessionIds = vi.fn();
const findSessionIdByCwd = vi.fn();
const fileLoggerLog = vi.fn();
const resolvePlanDecisionViaCli = vi.fn();
const resolvePlannerCwd = vi.fn();

vi.mock("@/lib/server/runtime-context", () => ({
  runtime: {
    getAuthStatus,
    streamNewSession,
    streamResumeSession,
  },
  limiter: {
    check: limiterCheck,
  },
  fileLogger: {
    log: fileLoggerLog,
  },
}));

vi.mock("@/lib/history/service", () => ({
  getConversationMeta,
  listSessionIds,
  findSessionIdByCwd,
}));

vi.mock("@/lib/plan/planner", () => ({
  resolvePlanDecisionViaCli,
  resolvePlannerCwd,
}));

describe("POST /api/chat/stream", () => {
  beforeEach(() => {
    process.env.APP_ACCESS_CODE = "secret";
    getAuthStatus.mockReset();
    streamNewSession.mockReset();
    streamResumeSession.mockReset();
    limiterCheck.mockReset();
    getConversationMeta.mockReset();
    listSessionIds.mockReset();
    findSessionIdByCwd.mockReset();
    fileLoggerLog.mockReset();
    resolvePlanDecisionViaCli.mockReset();
    resolvePlannerCwd.mockReset();
    fileLoggerLog.mockResolvedValue(undefined);
    resolvePlannerCwd.mockReturnValue("C:\\Users\\dell\\.codex\\worktrees\\codexmob-plan");
    resolvePlanDecisionViaCli.mockResolvedValue({
      plannerBranch: "new",
      decision: {
        kind: "ask_next",
        reason: "need_more_context",
        question: {
          id: "q1",
          prompt: "请确认目标用户类型",
          allowNote: true,
          options: [
            {
              value: "newbie",
              label: "小白用户",
              description: "默认推荐",
              recommended: true,
            },
            {
              value: "mixed",
              label: "混合用户",
              description: "补充经验差异",
            },
          ],
        },
      },
    });
    resetPlanSessionsForTests();
  });

  it("streams new session and returns detected conversationId", async () => {
    limiterCheck.mockReturnValue({
      allowed: true,
      remaining: 10,
      retryAfterMs: 1000,
    });
    getAuthStatus.mockResolvedValue({
      ready: true,
      loginMethod: "chatgpt",
    });
    listSessionIds.mockResolvedValue(new Set(["old-1"]));
    findSessionIdByCwd.mockResolvedValue("new-1");
    streamNewSession.mockImplementation(
      async (
        _payload: unknown,
        options: {
          onToken: (token: string) => void;
        },
      ) => {
        options.onToken("hello");
        return {
          text: "hello",
          aborted: false,
          usage: {
            output_tokens: 1,
          },
        };
      },
    );

    const { POST } = await import("@/app/api/chat/stream/route");
    const response = await POST(
      new Request("http://localhost/api/chat/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-app-access-code": "secret",
        },
        body: JSON.stringify({
          model: "gpt-5.4",
          cwd: "D:\\code\\CodexMob",
          input: "hello",
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("event: token");
    expect(body).toContain("event: done");
    expect(body).toContain("\"conversationId\":\"new-1\"");
    expect(streamResumeSession).not.toHaveBeenCalled();
    expect(fileLoggerLog).toHaveBeenCalled();
  });

  it("streams resume session when conversationId is provided", async () => {
    limiterCheck.mockReturnValue({
      allowed: true,
      remaining: 10,
      retryAfterMs: 1000,
    });
    getAuthStatus.mockResolvedValue({
      ready: true,
      loginMethod: "chatgpt",
    });
    getConversationMeta.mockResolvedValue({
      id: "c1",
      cwd: "D:\\code\\CodexMob",
    });
    streamResumeSession.mockResolvedValue({
      text: "ok",
      aborted: false,
      usage: { output_tokens: 1 },
    });

    const { POST } = await import("@/app/api/chat/stream/route");
    const response = await POST(
      new Request("http://localhost/api/chat/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-app-access-code": "secret",
        },
        body: JSON.stringify({
          conversationId: "c1",
          model: "gpt-5.4",
          input: "hi again",
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("\"conversationId\":\"c1\"");
    expect(streamNewSession).not.toHaveBeenCalled();
  });

  it("logs mode and injection profile for plan requests", async () => {
    limiterCheck.mockReturnValue({
      allowed: true,
      remaining: 10,
      retryAfterMs: 1000,
    });
    getAuthStatus.mockResolvedValue({
      ready: true,
      loginMethod: "chatgpt",
    });
    listSessionIds.mockResolvedValue(new Set(["old-1"]));
    findSessionIdByCwd.mockResolvedValue("new-1");
    streamNewSession.mockResolvedValue({
      text: "ok",
      aborted: false,
      usage: { output_tokens: 1 },
    });

    const { POST } = await import("@/app/api/chat/stream/route");
    const response = await POST(
      new Request("http://localhost/api/chat/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-app-access-code": "secret",
        },
        body: JSON.stringify({
          model: "gpt-5.4",
          cwd: "D:\\code\\CodexMob",
          input: "hello",
          mode: "plan",
          planSessionId: "plan-1",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(
      fileLoggerLog.mock.calls.some(
        ([entry]) =>
          entry?.type === "request_received" &&
          entry?.mode === "plan" &&
          entry?.injectionProfile === "plan_v1",
      ),
    ).toBe(true);
    expect(
      fileLoggerLog.mock.calls.some(
        ([entry]) =>
          entry?.type === "plan_step" &&
          entry?.planDecision === "ask_next" &&
          entry?.planStage === "clarifying" &&
          entry?.questionSource === "model_planner",
      ),
    ).toBe(true);
  });

  it("returns a context-aware plan question from planner turn", async () => {
    limiterCheck.mockReturnValue({
      allowed: true,
      remaining: 10,
      retryAfterMs: 1000,
    });
    getAuthStatus.mockResolvedValue({
      ready: true,
      loginMethod: "chatgpt",
    });
    listSessionIds.mockResolvedValue(new Set());

    const { POST } = await import("@/app/api/chat/stream/route");
    const response = await POST(
      new Request("http://localhost/api/chat/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-app-access-code": "secret",
        },
        body: JSON.stringify({
          model: "gpt-5.4",
          cwd: "D:\\code\\CodexMob",
          input: "创建1个skill，用于面对小白用户，并拆分为多个合理边界的skill+sop",
          mode: "plan",
          planSessionId: "plan-2",
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("event: plan_question");
    expect(body).toContain("请确认目标用户类型");
    expect(resolvePlanDecisionViaCli).toHaveBeenCalledTimes(1);
    expect(streamNewSession).not.toHaveBeenCalled();
    expect(streamResumeSession).not.toHaveBeenCalled();
  });

  it("returns 400 when new session cwd is missing", async () => {
    limiterCheck.mockReturnValue({
      allowed: true,
      remaining: 10,
      retryAfterMs: 1000,
    });
    getAuthStatus.mockResolvedValue({
      ready: true,
      loginMethod: "chatgpt",
    });

    const { POST } = await import("@/app/api/chat/stream/route");
    const response = await POST(
      new Request("http://localhost/api/chat/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-app-access-code": "secret",
        },
        body: JSON.stringify({
          model: "gpt-5.4",
          input: "hello",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(streamNewSession).not.toHaveBeenCalled();
  });

  it("returns 400 when plan mode new session misses planSessionId", async () => {
    limiterCheck.mockReturnValue({
      allowed: true,
      remaining: 10,
      retryAfterMs: 1000,
    });
    getAuthStatus.mockResolvedValue({
      ready: true,
      loginMethod: "chatgpt",
    });

    const { POST } = await import("@/app/api/chat/stream/route");
    const response = await POST(
      new Request("http://localhost/api/chat/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-app-access-code": "secret",
        },
        body: JSON.stringify({
          model: "gpt-5.4",
          cwd: "D:\\code\\CodexMob",
          input: "计划一个改造",
          mode: "plan",
        }),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain("planSessionId");
  });

  it("maps resume sandbox argument error to readable message", async () => {
    limiterCheck.mockReturnValue({
      allowed: true,
      remaining: 10,
      retryAfterMs: 1000,
    });
    getAuthStatus.mockResolvedValue({
      ready: true,
      loginMethod: "chatgpt",
    });
    getConversationMeta.mockResolvedValue({
      id: "c1",
      cwd: "D:\\code\\CodexMob",
    });
    streamResumeSession.mockRejectedValue(new Error("unexpected argument '--sandbox' found"));

    const { POST } = await import("@/app/api/chat/stream/route");
    const response = await POST(
      new Request("http://localhost/api/chat/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-app-access-code": "secret",
        },
        body: JSON.stringify({
          conversationId: "c1",
          model: "gpt-5.4",
          input: "hello",
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("event: error");
    expect(body).toContain("恢复会话命令参数与当前 Codex CLI 版本不兼容");
  });

  it("maps policy-blocked error to readable message", async () => {
    limiterCheck.mockReturnValue({
      allowed: true,
      remaining: 10,
      retryAfterMs: 1000,
    });
    getAuthStatus.mockResolvedValue({
      ready: true,
      loginMethod: "chatgpt",
    });
    getConversationMeta.mockResolvedValue({
      id: "c1",
      cwd: "D:\\code\\CodexMob",
    });
    streamResumeSession.mockRejectedValue(
      new Error("operation blocked by policy: rejected by user approval settings"),
    );

    const { POST } = await import("@/app/api/chat/stream/route");
    const response = await POST(
      new Request("http://localhost/api/chat/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-app-access-code": "secret",
        },
        body: JSON.stringify({
          conversationId: "c1",
          model: "gpt-5.4",
          input: "please write files",
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("event: error");
    expect(body).toContain("当前会话权限策略不允许写操作");
  });
});
