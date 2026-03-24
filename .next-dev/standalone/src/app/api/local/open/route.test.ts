import { beforeEach, describe, expect, it, vi } from "vitest";

const openLocalPathInSystem = vi.fn();

vi.mock("@/lib/local/open", () => ({
  openLocalPathInSystem,
}));

describe("POST /api/local/open", () => {
  beforeEach(() => {
    process.env.APP_ACCESS_CODE = "secret";
    openLocalPathInSystem.mockReset();
    openLocalPathInSystem.mockResolvedValue(undefined);
  });

  it("opens local path when request is valid", async () => {
    const { POST } = await import("@/app/api/local/open/route");
    const request = new Request("http://localhost/api/local/open", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-app-access-code": "secret",
      },
      body: JSON.stringify({ path: "D:\\code\\skills-dev\\README.md" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(openLocalPathInSystem).toHaveBeenCalledWith("D:\\code\\skills-dev\\README.md");
  });

  it("rejects invalid body", async () => {
    const { POST } = await import("@/app/api/local/open/route");
    const request = new Request("http://localhost/api/local/open", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-app-access-code": "secret",
      },
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });
});
