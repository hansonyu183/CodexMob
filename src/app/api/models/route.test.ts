import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthStatus = vi.fn();

vi.mock("@/lib/server/runtime-context", () => ({
  runtime: {
    getAuthStatus,
  },
}));

describe("GET /api/models", () => {
  beforeEach(() => {
    process.env.APP_ACCESS_CODE = "secret";
    process.env.DEFAULT_MODEL = "gpt-5.4";
    process.env.ALLOWED_MODELS = "gpt-5.4,gpt-5.3-codex";
    getAuthStatus.mockReset();
  });

  it("returns configured models", async () => {
    getAuthStatus.mockResolvedValue({
      ready: true,
      loginMethod: "chatgpt",
    });

    const { GET } = await import("@/app/api/models/route");
    const request = new Request("http://localhost/api/models", {
      headers: {
        "x-app-access-code": "secret",
      },
    });

    const response = await GET(request);
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.defaultModel).toBe("gpt-5.4");
    expect(body.models).toContain("gpt-5.3-codex");
  });

  it("returns auth required when runtime not ready", async () => {
    getAuthStatus.mockResolvedValue({
      ready: false,
      loginMethod: "none",
      message: "not logged in",
    });

    const { GET } = await import("@/app/api/models/route");
    const request = new Request("http://localhost/api/models", {
      headers: {
        "x-app-access-code": "secret",
      },
    });

    const response = await GET(request);
    expect(response.status).toBe(401);
  });
});

