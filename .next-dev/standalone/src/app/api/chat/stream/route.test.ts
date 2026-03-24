import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthStatus = vi.fn();
const streamNewSession = vi.fn();
const streamResumeSession = vi.fn();
const limiterCheck = vi.fn();
const getConversationMeta = vi.fn();
const listSessionIds = vi.fn();
const findSessionIdByCwd = vi.fn();
const fileLoggerLog = vi.fn();

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
    fileLoggerLog.mockResolvedValue(undefined);
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
