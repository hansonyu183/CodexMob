import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthStatus = vi.fn();
const getLocalModelConfig = vi.fn();
const getLocalSandboxModeSync = vi.fn();

vi.mock("@/lib/server/runtime-context", () => ({
  runtime: {
    getAuthStatus,
  },
}));

vi.mock("@/lib/codex/config", () => ({
  getLocalModelConfig,
  getLocalSandboxModeSync,
}));

describe("GET /api/models", () => {
  beforeEach(() => {
    process.env.APP_ACCESS_CODE = "secret";
    process.env.DEFAULT_MODEL = "gpt-5.4";
    process.env.ALLOWED_MODELS = "gpt-5.4,gpt-5.3-codex";
    getAuthStatus.mockReset();
    getLocalModelConfig.mockReset();
    getLocalSandboxModeSync.mockReset();
    getLocalSandboxModeSync.mockReturnValue("read-only");
    getLocalModelConfig.mockResolvedValue({
      defaultModel: "gpt-5.4",
      models: ["gpt-5.4", "gpt-5.3-codex"],
    });
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

  it("prefers local codex config default model", async () => {
    getAuthStatus.mockResolvedValue({
      ready: true,
      loginMethod: "chatgpt",
    });
    getLocalModelConfig.mockResolvedValue({
      defaultModel: "gpt-5.4-mini",
      models: ["gpt-5.4-mini", "gpt-5.3-codex"],
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
    expect(body.defaultModel).toBe("gpt-5.4-mini");
    expect(body.models).toContain("gpt-5.4-mini");
  });

  it("falls back when local config has no models", async () => {
    getAuthStatus.mockResolvedValue({
      ready: true,
      loginMethod: "chatgpt",
    });
    getLocalModelConfig.mockResolvedValue({
      defaultModel: null,
      models: [],
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
    expect(Array.isArray(body.models)).toBe(true);
    expect(body.models.length).toBeGreaterThan(0);
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
