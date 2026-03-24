import type {
  ApiErrorShape,
  ChatUsage,
  PlanProgress,
  PlanQuestion,
  StreamStatusEvent,
  StreamToolEvent,
} from "@/lib/types";

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onDone: (payload: { usage?: ChatUsage; conversationId?: string | null }) => void;
  onError: (error: ApiErrorShape) => void;
  onStatus?: (event: StreamStatusEvent) => void;
  onTool?: (event: StreamToolEvent) => void;
  onPlanQuestion?: (event: PlanQuestion) => void;
  onPlanProgress?: (event: PlanProgress) => void;
  onPlanReady?: (event: PlanProgress) => void;
}

export interface StreamState {
  content: string;
  status: "streaming" | "done" | "error";
  error?: ApiErrorShape;
}

export function appendToken(state: StreamState, token: string): StreamState {
  return {
    ...state,
    content: state.content + token,
  };
}

export function finishStream(state: StreamState): StreamState {
  return {
    ...state,
    status: "done",
  };
}

export function failStream(state: StreamState, error: ApiErrorShape): StreamState {
  return {
    ...state,
    status: "error",
    error,
  };
}

function parseEventBlock(block: string): { event: string; data: string } | null {
  const lines = block.split(/\r?\n/);
  let event = "";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (!event || dataLines.length === 0) {
    return null;
  }

  return {
    event,
    data: dataLines.join("\n"),
  };
}

export async function consumeSse(
  response: Response,
  callbacks: StreamCallbacks,
): Promise<void> {
  if (!response.ok) {
    let payload: ApiErrorShape = {
      code: "UPSTREAM_ERROR",
      message: `Request failed (${response.status})`,
    };

    try {
      const json = (await response.json()) as Partial<ApiErrorShape>;
      if (typeof json.code === "string" && typeof json.message === "string") {
        payload = {
          code: json.code as ApiErrorShape["code"],
          message: json.message,
        };
      }
    } catch {
      // ignore response parsing failure
    }

    callbacks.onError(payload);
    return;
  }

  if (!response.body) {
    callbacks.onError({
      code: "UPSTREAM_ERROR",
      message: "Stream body is empty.",
    });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let boundaryIndex = buffer.indexOf("\n\n");
    while (boundaryIndex >= 0) {
      const rawEvent = buffer.slice(0, boundaryIndex);
      buffer = buffer.slice(boundaryIndex + 2);
      boundaryIndex = buffer.indexOf("\n\n");

      const parsed = parseEventBlock(rawEvent);
      if (!parsed) {
        continue;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(parsed.data);
      } catch {
        continue;
      }

      if (parsed.event === "token") {
        const token = (payload as { token?: string }).token;
        if (typeof token === "string" && token.length > 0) {
          callbacks.onToken(token);
        }
      }

      if (parsed.event === "done") {
        const donePayload = payload as {
          usage?: ChatUsage;
          conversationId?: string | null;
        };
        callbacks.onDone({
          usage: donePayload.usage,
          conversationId: donePayload.conversationId,
        });
      }

      if (parsed.event === "status" && callbacks.onStatus) {
        const event = payload as Partial<StreamStatusEvent>;
        if (typeof event.phase === "string" && event.phase.trim()) {
          callbacks.onStatus({
            phase: event.phase.trim(),
            detail: typeof event.detail === "string" ? event.detail : undefined,
          });
        }
      }

      if (parsed.event === "tool" && callbacks.onTool) {
        const event = payload as Partial<StreamToolEvent>;
        if (
          typeof event.name === "string" &&
          (event.state === "start" || event.state === "end")
        ) {
          callbacks.onTool({
            name: event.name,
            state: event.state,
            summary: typeof event.summary === "string" ? event.summary : undefined,
          });
        }
      }

      if (parsed.event === "plan_question" && callbacks.onPlanQuestion) {
        const event = payload as Partial<{
          items: PlanQuestion[];
        } & PlanQuestion>;
        if (Array.isArray(event.items)) {
          const first = event.items.find(
            (item) =>
              typeof item?.id === "string" &&
              typeof item?.prompt === "string" &&
              Array.isArray(item?.options),
          );
          if (first) {
            callbacks.onPlanQuestion({
              id: first.id,
              prompt: first.prompt,
              options: first.options as PlanQuestion["options"],
              allowNote: first.allowNote === true,
            });
          }
        } else if (
          typeof event.id === "string" &&
          typeof event.prompt === "string" &&
          Array.isArray(event.options)
        ) {
          callbacks.onPlanQuestion({
            id: event.id,
            prompt: event.prompt,
            options: event.options as PlanQuestion["options"],
            allowNote: event.allowNote === true,
          });
        }
      }

      if (parsed.event === "plan_progress" && callbacks.onPlanProgress) {
        const event = payload as Partial<PlanProgress>;
        if (typeof event.phase === "string") {
          callbacks.onPlanProgress({
            phase: event.phase,
            answered: typeof event.answered === "number" ? event.answered : 0,
            total: typeof event.total === "number" ? event.total : 0,
            summary: typeof event.summary === "string" ? event.summary : undefined,
          });
        }
      }

      if (parsed.event === "plan_ready" && callbacks.onPlanReady) {
        const event = payload as Partial<PlanProgress>;
        if (typeof event.phase === "string") {
          callbacks.onPlanReady({
            phase: event.phase,
            answered: typeof event.answered === "number" ? event.answered : 0,
            total: typeof event.total === "number" ? event.total : 0,
            summary: typeof event.summary === "string" ? event.summary : undefined,
          });
        }
      }

      if (parsed.event === "error") {
        const err = payload as Partial<ApiErrorShape>;
        callbacks.onError({
          code: (err.code as ApiErrorShape["code"]) ?? "UPSTREAM_ERROR",
          message: err.message ?? "Unknown streaming error.",
        });
      }
    }
  }
}
