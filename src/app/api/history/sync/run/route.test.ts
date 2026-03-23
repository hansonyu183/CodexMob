import { beforeEach, describe, expect, it, vi } from "vitest";

const runSync = vi.fn();

vi.mock("@/lib/history/service", () => ({
  runSync,
}));

describe("POST /api/history/sync/run", () => {
  beforeEach(() => {
    process.env.APP_ACCESS_CODE = "secret";
    runSync.mockReset();
  });

  it("returns sync payload", async () => {
    runSync.mockResolvedValue({
      syncedSessions: 2,
      syncedMessages: 9,
      latestRev: 0,
      durationMs: 23,
    });

    const { POST } = await import("@/app/api/history/sync/run/route");
    const response = await POST(
      new Request("http://localhost/api/history/sync/run", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-app-access-code": "secret",
        },
        body: JSON.stringify({
          mode: "manual",
          cwdFilter: "D:\\code\\skills-dev",
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.syncedSessions).toBe(2);
    expect(body.latestRev).toBe(0);
    expect(runSync).toHaveBeenCalledWith({
      cwdFilter: "D:\\code\\skills-dev",
    });
  });
});
