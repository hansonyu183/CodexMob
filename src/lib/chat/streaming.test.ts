import { describe, expect, it } from "vitest";

import {
  appendToken,
  failStream,
  finishStream,
  type StreamState,
} from "@/lib/chat/streaming";

describe("stream state helpers", () => {
  it("appends token into assistant content", () => {
    const initial: StreamState = {
      content: "Hel",
      status: "streaming",
    };
    const next = appendToken(initial, "lo");
    expect(next.content).toBe("Hello");
    expect(next.status).toBe("streaming");
  });

  it("marks stream done", () => {
    const initial: StreamState = {
      content: "done",
      status: "streaming",
    };
    const next = finishStream(initial);
    expect(next.status).toBe("done");
  });

  it("marks stream error", () => {
    const initial: StreamState = {
      content: "",
      status: "streaming",
    };
    const next = failStream(initial, {
      code: "UPSTREAM_ERROR",
      message: "boom",
    });
    expect(next.status).toBe("error");
    expect(next.error?.message).toBe("boom");
  });
});

