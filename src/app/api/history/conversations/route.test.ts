import { beforeEach, describe, expect, it, vi } from "vitest";

const listHistoryConversations = vi.fn();
const upsertNativeConversation = vi.fn();

vi.mock("@/lib/history/service", () => ({
  listHistoryConversations,
  upsertNativeConversation,
}));

describe("history conversations route", () => {
  beforeEach(() => {
    process.env.APP_ACCESS_CODE = "secret";
    listHistoryConversations.mockReset();
    upsertNativeConversation.mockReset();
  });

  it("lists conversations", async () => {
    listHistoryConversations.mockResolvedValue({
      items: [
        {
          id: "c1",
          title: "A",
          updatedAt: "2026-01-01T00:00:00.000Z",
          source: "codex_active",
          cwd: "D:\\code\\CodexMob",
          archived: false,
        },
      ],
    });

    const { GET } = await import("@/app/api/history/conversations/route");
    const response = await GET(
      new Request("http://localhost/api/history/conversations", {
        headers: { "x-app-access-code": "secret" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toHaveLength(1);
  });

  it("creates native conversation", async () => {
    upsertNativeConversation.mockResolvedValue({
      id: "c2",
      title: "new",
      updatedAt: "2026-01-01T00:00:00.000Z",
      source: "codex_active",
      cwd: "D:\\code\\CodexMob",
      archived: false,
    });

    const { POST } = await import("@/app/api/history/conversations/route");
    const response = await POST(
      new Request("http://localhost/api/history/conversations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-app-access-code": "secret",
        },
        body: JSON.stringify({ title: "new", cwd: "D:\\code\\CodexMob" }),
      }),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.id).toBe("c2");
    expect(upsertNativeConversation).toHaveBeenCalledWith({
      id: undefined,
      title: "new",
      model: undefined,
      cwd: "D:\\code\\CodexMob",
    });
  });

  it("rejects creation without cwd", async () => {
    const { POST } = await import("@/app/api/history/conversations/route");
    const response = await POST(
      new Request("http://localhost/api/history/conversations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-app-access-code": "secret",
        },
        body: JSON.stringify({ title: "new" }),
      }),
    );

    expect(response.status).toBe(400);
  });
});
