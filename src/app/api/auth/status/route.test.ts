import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthStatus = vi.fn();

vi.mock("@/lib/server/runtime-context", () => ({
  runtime: {
    getAuthStatus,
  },
}));

describe("GET /api/auth/status", () => {
  beforeEach(() => {
    process.env.APP_ACCESS_CODE = "secret";
    getAuthStatus.mockReset();
  });

  it("returns auth status when access code is valid", async () => {
    getAuthStatus.mockResolvedValue({
      ready: true,
      loginMethod: "chatgpt",
      message: "ok",
    });

    const { GET } = await import("@/app/api/auth/status/route");
    const request = new Request("http://localhost/api/auth/status", {
      headers: {
        "x-app-access-code": "secret",
      },
    });

    const response = await GET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.ready).toBe(true);
    expect(body.loginMethod).toBe("chatgpt");
  });

  it("rejects invalid access code", async () => {
    const { GET } = await import("@/app/api/auth/status/route");
    const request = new Request("http://localhost/api/auth/status", {
      headers: {
        "x-app-access-code": "wrong",
      },
    });

    const response = await GET(request);
    expect(response.status).toBe(401);
  });
});

