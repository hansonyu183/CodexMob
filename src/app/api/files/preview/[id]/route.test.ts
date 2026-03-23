import { beforeEach, describe, expect, it, vi } from "vitest";

const getUploadById = vi.fn();

vi.mock("@/lib/uploads/storage", () => ({
  getUploadById,
}));

describe("GET /api/files/preview/[id]", () => {
  beforeEach(() => {
    process.env.APP_ACCESS_CODE = "secret";
    getUploadById.mockReset();
  });

  it("returns 404 when attachment not found", async () => {
    getUploadById.mockResolvedValue(null);
    const { GET } = await import("@/app/api/files/preview/[id]/route");
    const request = new Request("http://localhost/api/files/preview/a", {
      headers: {
        "x-app-access-code": "secret",
      },
    });

    const response = await GET(request, {
      params: Promise.resolve({ id: "a" }),
    });
    expect(response.status).toBe(404);
  });
});
