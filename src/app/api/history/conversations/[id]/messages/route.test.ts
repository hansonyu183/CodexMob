import { beforeEach, describe, expect, it, vi } from "vitest";

const listHistoryMessages = vi.fn();

vi.mock("@/lib/history/service", () => ({
  listHistoryMessages,
}));

describe("history messages route", () => {
  beforeEach(() => {
    process.env.APP_ACCESS_CODE = "secret";
    listHistoryMessages.mockReset();
  });

  it("lists messages", async () => {
    listHistoryMessages.mockResolvedValue([
      {
        id: "m1",
        conversationId: "c1",
        role: "user",
        content: "hi",
        createdAt: "2026-01-01T00:00:00.000Z",
        source: "codex_active",
      },
    ]);

    const { GET } = await import("@/app/api/history/conversations/[id]/messages/route");
    const response = await GET(
      new Request("http://localhost/api/history/conversations/c1/messages", {
        headers: { "x-app-access-code": "secret" },
      }),
      { params: Promise.resolve({ id: "c1" }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toHaveLength(1);
  });

  it("rejects manual append and requires chat stream", async () => {
    const { POST } = await import("@/app/api/history/conversations/[id]/messages/route");
    const response = await POST(
      new Request("http://localhost/api/history/conversations/c1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-app-access-code": "secret",
        },
        body: JSON.stringify({ role: "user", content: "hello" }),
      }),
      { params: Promise.resolve({ id: "c1" }) },
    );

    expect(response.status).toBe(405);
    const body = await response.json();
    expect(body.code).toBe("INVALID_REQUEST");
  });
});
