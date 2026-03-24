import { beforeEach, describe, expect, it, vi } from "vitest";

const listUploadsByConversationId = vi.fn();

vi.mock("@/lib/uploads/storage", () => ({
  listUploadsByConversationId,
}));

describe("GET /api/files/conversations/[id]", () => {
  beforeEach(() => {
    process.env.APP_ACCESS_CODE = "secret";
    listUploadsByConversationId.mockReset();
  });

  it("returns mapped attachment refs", async () => {
    listUploadsByConversationId.mockResolvedValue([
      { id: "u1", name: "a.md", path: "D:\\tmp\\u1-a.md", kind: "text", size: 12 },
    ]);

    const { GET } = await import("@/app/api/files/conversations/[id]/route");
    const request = new Request("http://localhost/api/files/conversations/c1", {
      headers: {
        "x-app-access-code": "secret",
      },
    });

    const response = await GET(request, {
      params: Promise.resolve({ id: "c1" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items?.[0]?.conversationId).toBe("c1");
  });
});
