export const SSE_HEADERS: HeadersInit = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
};

export function createSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function enqueueSse(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: string,
  data: unknown,
) {
  const chunk = createSseEvent(event, data);
  controller.enqueue(new TextEncoder().encode(chunk));
}

