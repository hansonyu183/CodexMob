import { errorResponse } from "@/lib/errors";
import { serverEnv } from "@/lib/env";
import { extractClientIp, verifyAccessCode } from "@/lib/security/access";
import { enqueueSse, SSE_HEADERS } from "@/lib/sse";
import { validateChatPayload } from "@/lib/chat/validate";
import {
  findSessionIdByCwd,
  getConversationMeta,
  listSessionIds,
} from "@/lib/history/service";
import { bindUploadsToConversation } from "@/lib/uploads/storage";
import { fileLogger, limiter, runtime as codexRuntime } from "@/lib/server/runtime-context";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();

  const denied = verifyAccessCode(request, serverEnv.appAccessCode);
  if (denied) {
    await fileLogger.log({
      ts: new Date().toISOString(),
      type: "request_denied",
      requestId,
      code: denied.code,
      message: denied.message,
    });
    return errorResponse(denied.code, denied.message, denied.code === "ACCESS_DENIED" ? 401 : 503);
  }

  const ip = extractClientIp(request);
  const rateLimit = limiter.check(ip);
  if (!rateLimit.allowed) {
    await fileLogger.log({
      ts: new Date().toISOString(),
      type: "rate_limited",
      requestId,
      ip,
      retryAfterMs: rateLimit.retryAfterMs,
    });
    return errorResponse(
      "RATE_LIMITED",
      `Too many requests. Retry in ${Math.ceil(rateLimit.retryAfterMs / 1000)}s.`,
      429,
    );
  }

  let rawPayload: unknown;
  try {
    rawPayload = await request.json();
  } catch {
    await fileLogger.log({
      ts: new Date().toISOString(),
      type: "invalid_json",
      requestId,
      ip,
    });
    return errorResponse("INVALID_REQUEST", "Invalid JSON body.", 400);
  }

  const payload = validateChatPayload(rawPayload);
  if (!payload) {
    await fileLogger.log({
      ts: new Date().toISOString(),
      type: "invalid_payload",
      requestId,
      ip,
    });
    return errorResponse("INVALID_REQUEST", "Invalid chat payload.", 400);
  }

  await fileLogger.log({
    ts: new Date().toISOString(),
    type: "request_received",
    requestId,
    ip,
    model: payload.model,
    conversationId: payload.conversationId ?? null,
    cwd: payload.cwd ?? null,
    sandbox: serverEnv.codexSandbox,
    inputPreview: payload.input,
  });

  const auth = await codexRuntime.getAuthStatus();
  if (!auth.ready) {
    await fileLogger.log({
      ts: new Date().toISOString(),
      type: "auth_required",
      requestId,
      loginMethod: auth.loginMethod,
      message: auth.message ?? "",
    });
    return errorResponse("AUTH_REQUIRED", auth.message ?? "Codex is not logged in.", 401);
  }

  let resolvedConversationId = payload.conversationId?.trim() || "";
  let resolvedCwd = payload.cwd?.trim() || "";

  if (resolvedConversationId) {
    const meta = await getConversationMeta({
      conversationId: resolvedConversationId,
    });
    const metaCwd = meta?.cwd?.trim() || "";
    if (!metaCwd) {
      await fileLogger.log({
        ts: new Date().toISOString(),
        type: "missing_meta_cwd",
        requestId,
        conversationId: resolvedConversationId,
      });
      return errorResponse(
        "INVALID_REQUEST",
        "会话缺少项目路径，请先在项目下新建会话。",
        400,
      );
    }
    resolvedCwd = metaCwd;
  } else if (!resolvedCwd) {
    await fileLogger.log({
      ts: new Date().toISOString(),
      type: "missing_cwd_for_new_session",
      requestId,
    });
    return errorResponse("INVALID_REQUEST", "新会话必须携带 cwd。", 400);
  }

  const knownIds = !resolvedConversationId ? await listSessionIds() : new Set<string>();
  await fileLogger.log({
    ts: new Date().toISOString(),
    type: "branch_selected",
    requestId,
    branch: resolvedConversationId ? "resume" : "new",
    conversationId: resolvedConversationId || null,
    cwd: resolvedCwd,
  });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      enqueueSse(controller, "ready", {
        conversationId: resolvedConversationId || null,
        model: payload.model,
      });

      const run = resolvedConversationId
        ? codexRuntime.streamResumeSession(
            {
              conversationId: resolvedConversationId,
              model: payload.model,
              message: payload.input,
              cwd: resolvedCwd,
              sandbox: serverEnv.codexSandbox,
              mode: payload.mode,
              attachments: payload.attachments,
            },
            {
              signal: request.signal,
              onToken(token) {
                enqueueSse(controller, "token", { token });
              },
              onStatus(event) {
                enqueueSse(controller, "status", event);
              },
              onTool(event) {
                enqueueSse(controller, "tool", event);
              },
            },
          )
        : codexRuntime.streamNewSession(
            {
              model: payload.model,
              message: payload.input,
              cwd: resolvedCwd,
              sandbox: serverEnv.codexSandbox,
              mode: payload.mode,
              attachments: payload.attachments,
            },
            {
              signal: request.signal,
              onToken(token) {
                enqueueSse(controller, "token", { token });
              },
              onStatus(event) {
                enqueueSse(controller, "status", event);
              },
              onTool(event) {
                enqueueSse(controller, "tool", event);
              },
            },
          );

      void fileLogger.log({
        ts: new Date().toISOString(),
        type: "cli_spawned",
        requestId,
        branch: resolvedConversationId ? "resume" : "new",
        conversationId: resolvedConversationId || null,
        cwd: resolvedCwd,
        model: payload.model,
        sandbox: serverEnv.codexSandbox,
      });

      void run
        .then(async (result) => {
          if (!resolvedConversationId) {
            const detected = await findSessionIdByCwd({
              cwd: resolvedCwd,
              knownIds,
            });
            if (detected) {
              resolvedConversationId = detected;
            }
            await fileLogger.log({
              ts: new Date().toISOString(),
              type: "session_resolved",
              requestId,
              cwd: resolvedCwd,
              conversationId: resolvedConversationId || null,
            });
          }

          if (resolvedConversationId && payload.attachments && payload.attachments.length > 0) {
            await bindUploadsToConversation(
              payload.attachments.map((item) => item.id),
              resolvedConversationId,
            );
          }

          enqueueSse(controller, "done", {
            usage: result.usage,
            aborted: result.aborted,
            conversationId: resolvedConversationId || null,
          });
          const abortSource = result.aborted
            ? request.signal.aborted
              ? "client_abort"
              : "runtime_abort"
            : "none";
          await fileLogger.log({
            ts: new Date().toISOString(),
            type: "stream_done",
            requestId,
            conversationId: resolvedConversationId || null,
            aborted: result.aborted,
            abortSource,
            sandbox: serverEnv.codexSandbox,
            usage: result.usage ?? null,
          });
          controller.close();
        })
        .catch(async (error) => {
          const rawMessage =
            error instanceof Error ? error.message : "Failed to stream from Codex.";
          const lowered = rawMessage.toLowerCase();
          const isCliVersionMismatch =
            lowered.includes("migration") &&
            lowered.includes("was previously applied") &&
            lowered.includes("missing in the resolved migrations");
          const isTimeoutError =
            lowered.includes("codex execution timed out") ||
            lowered.includes("codex command timed out");
          const message = lowered.includes("unexpected argument '--sandbox'")
            ? "恢复会话命令参数与当前 Codex CLI 版本不兼容，请重试或更新客户端参数。"
            : isCliVersionMismatch
              ? "本机 Codex CLI 版本与本地状态库不兼容，请升级 Codex CLI 后重试。"
              : isTimeoutError
                ? "本轮执行超时，请重试或缩短问题范围。"
            : request.signal.aborted
              ? "客户端连接已中断，可重试。"
            : rawMessage;
          enqueueSse(controller, "error", {
            code: "UPSTREAM_ERROR",
            message,
          });
          await fileLogger.log({
            ts: new Date().toISOString(),
            type: "stream_error",
            requestId,
            conversationId: resolvedConversationId || null,
            cwd: resolvedCwd,
            rawMessage,
            mappedMessage: message,
            abortSource: request.signal.aborted ? "client_abort" : "runtime_error",
            errorCategory: isCliVersionMismatch
              ? "cli_version_mismatch"
              : isTimeoutError
                ? "timeout"
              : "general_upstream_error",
            sandbox: serverEnv.codexSandbox,
          });
          controller.close();
        });
    },
  });

  const headers = new Headers(SSE_HEADERS);
  headers.set("X-RateLimit-Remaining", String(rateLimit.remaining));
  headers.set("X-RateLimit-Reset-Ms", String(rateLimit.retryAfterMs));

  return new Response(stream, { headers });
}
