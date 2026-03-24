import { describe, expect, it } from "vitest";

import {
  appendToken,
  consumeSse,
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

describe("consumeSse", () => {
  it("parses token/status/tool/done events", async () => {
    const payload = [
      'event: status\ndata: {"phase":"thinking","detail":"处理中"}\n\n',
      'event: tool\ndata: {"name":"shell","state":"start","summary":"run"}\n\n',
      'event: token\ndata: {"token":"hel"}\n\n',
      'event: token\ndata: {"token":"lo"}\n\n',
      'event: done\ndata: {"conversationId":"c1"}\n\n',
    ].join("");
    const response = new Response(payload, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
      },
    });

    const tokens: string[] = [];
    const statuses: string[] = [];
    const tools: string[] = [];
    let doneConversationId = "";

    await consumeSse(response, {
      onToken(token) {
        tokens.push(token);
      },
      onDone(result) {
        doneConversationId = result.conversationId ?? "";
      },
      onError() {
        throw new Error("should not fail");
      },
      onStatus(event) {
        statuses.push(`${event.phase}:${event.detail ?? ""}`);
      },
      onTool(event) {
        tools.push(`${event.name}:${event.state}`);
      },
    });

    expect(tokens.join("")).toBe("hello");
    expect(statuses).toEqual(["thinking:处理中"]);
    expect(tools).toEqual(["shell:start"]);
    expect(doneConversationId).toBe("c1");
  });

  it("parses plan_question/plan_progress/plan_ready events", async () => {
    const payload = [
      'event: plan_progress\ndata: {"phase":"clarifying","answered":0,"total":5,"round":1,"batchSize":3}\n\n',
      'event: plan_question\ndata: {"items":[{"id":"q1","prompt":"范围？","allowNote":true,"options":[{"value":"a","label":"A","description":"desc","recommended":true}]},{"id":"q2","prompt":"约束？","allowNote":false,"options":[{"value":"b","label":"B","description":"desc"}]}]}\n\n',
      'event: plan_ready\ndata: {"phase":"ready_to_plan","answered":4,"total":5}\n\n',
      'event: done\ndata: {"conversationId":"c1"}\n\n',
    ].join("");
    const response = new Response(payload, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
      },
    });

    let questionId = "";
    let readyPhase = "";
    const phases: string[] = [];

    await consumeSse(response, {
      onToken() {},
      onDone() {},
      onError() {
        throw new Error("should not fail");
      },
      onPlanQuestion(event) {
        questionId = event.id;
      },
      onPlanProgress(event) {
        phases.push(event.phase);
      },
      onPlanReady(event) {
        readyPhase = event.phase;
      },
    });

    expect(questionId).toBe("q1");
    expect(phases).toEqual(["clarifying"]);
    expect(readyPhase).toBe("ready_to_plan");
  });
});
