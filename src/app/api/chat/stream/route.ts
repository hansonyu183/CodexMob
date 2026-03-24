import { errorResponse } from "@/lib/errors";
import { serverEnv } from "@/lib/env";
import { extractClientIp, verifyAccessCode } from "@/lib/security/access";
import { enqueueSse, SSE_HEADERS } from "@/lib/sse";
import { validateChatPayload } from "@/lib/chat/validate";
import {
  applyPlanDecision,
  bindPlanPlannerConversation,
  buildPlanSessionKey,
  finalizePlanSession,
  hasPlanSession,
  preparePlanSessionTurn,
  type PlanSessionResult,
} from "@/lib/plan/state";
import { resolvePlanDecisionViaCli, resolvePlannerCwd } from "@/lib/plan/planner";
import {
  findSessionIdByCwd,
  getConversationMeta,
  listSessionIds,
} from "@/lib/history/service";
import { bindUploadsToConversation } from "@/lib/uploads/storage";
import { fileLogger, limiter, runtime as codexRuntime } from "@/lib/server/runtime-context";

export const runtime = "nodejs";

function getPolicyModeFromSandbox(sandbox: string): "read_only" | "full_auto" | "bypass_all" {
  if (sandbox === "danger-full-access") {
    return "bypass_all";
  }
  if (sandbox === "workspace-write") {
    return "full_auto";
  }
  return "read_only";
}

function getInjectionProfile(mode: "default" | "plan" | undefined): "default_v1" | "plan_v1" {
  return mode === "plan" ? "plan_v1" : "default_v1";
}

function createPlanSseResponse(input: {
  result: PlanSessionResult;
  conversationId: string;
  model: string;
  headers: Headers;
}) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      enqueueSse(controller, "ready", {
        conversationId: input.conversationId || null,
        model: input.model,
      });

      if (input.result.kind === "question") {
        enqueueSse(controller, "plan_progress", input.result.progress);
        enqueueSse(controller, "plan_question", input.result.question);
      }

      if (input.result.kind === "ready") {
        enqueueSse(controller, "plan_ready", input.result.progress);
      }

      enqueueSse(controller, "done", {
        aborted: false,
        conversationId: input.conversationId || null,
      });
      controller.close();
    },
  });

  return new Response(stream, { headers: input.headers });
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const policyMode = getPolicyModeFromSandbox(serverEnv.codexSandbox);

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
  const injectionProfile = getInjectionProfile(payload.mode);

  await fileLogger.log({
    ts: new Date().toISOString(),
    type: "request_received",
    requestId,
    ip,
    model: payload.model,
    conversationId: payload.conversationId ?? null,
    planSessionId: payload.planSessionId ?? null,
    cwd: payload.cwd ?? null,
    sandbox: serverEnv.codexSandbox,
    policyMode,
    mode: payload.mode ?? "default",
    injectionProfile,
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
  let runtimeInput = payload.input;
  let isPlanFinalizeTurn = false;

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

  const headers = new Headers(SSE_HEADERS);
  headers.set("X-RateLimit-Remaining", String(rateLimit.remaining));
  headers.set("X-RateLimit-Reset-Ms", String(rateLimit.retryAfterMs));

  if (payload.mode === "plan") {
    if (!resolvedConversationId && !payload.planSessionId?.trim()) {
      return errorResponse(
        "INVALID_REQUEST",
        "计划模式新会话缺少 planSessionId，请重新开始本轮计划。",
        400,
      );
    }

    const planKey = buildPlanSessionKey({
      conversationId: resolvedConversationId || undefined,
      planSessionId: payload.planSessionId,
      cwd: resolvedCwd,
      model: payload.model,
    });
    if (!planKey) {
      return errorResponse(
        "INVALID_REQUEST",
        "计划模式会话标识无效，请重新开始本轮计划。",
        400,
      );
    }

    const planAnswers =
      payload.planAnswers && payload.planAnswers.length > 0
        ? payload.planAnswers
        : payload.planAnswer
          ? [payload.planAnswer]
          : null;

    if (payload.planAnswers && payload.planAnswers.length > 1) {
      await fileLogger.log({
        ts: new Date().toISOString(),
        type: "plan_answers_compat",
        requestId,
        mode: "plan",
        message: "planAnswers contains multiple entries; only the first one will be used.",
        planAnswersCount: payload.planAnswers.length,
        conversationId: resolvedConversationId || null,
      });
    }

    if (planAnswers || !hasPlanSession(planKey)) {
      let plannerContext: ReturnType<typeof preparePlanSessionTurn>["context"];
      try {
        const prepared = preparePlanSessionTurn({
          key: planKey,
          cwd: resolvedCwd,
          prompt: payload.input,
          answer: planAnswers?.[0],
        });
        plannerContext = prepared.context;
      } catch {
        return errorResponse("INVALID_REQUEST", "计划模式回答与当前问题不匹配。", 400);
      }

      const plannerCwd = resolvePlannerCwd(serverEnv.codexHome, resolvedCwd);
      const plannerKnownIds =
        plannerContext.plannerConversationId || plannerContext.plannerWarm
          ? null
          : await listSessionIds();
      let plannerDecisionResult;
      const plannerStartedAt = Date.now();
      try {
        plannerDecisionResult = await resolvePlanDecisionViaCli({
          runtime: codexRuntime,
          model: payload.model,
          plannerCwd,
          context: plannerContext,
          plannerConversationId: plannerContext.plannerConversationId,
          signal: request.signal,
        });
      } catch (error) {
        await fileLogger.log({
          ts: new Date().toISOString(),
          type: "plan_error",
          requestId,
          mode: "plan",
          stage: "planner_turn",
          message: error instanceof Error ? error.message : "planner_failed",
          conversationId: resolvedConversationId || null,
        });
        return errorResponse("UPSTREAM_ERROR", "计划模式生成澄清问题失败，请重试。", 502);
      }

      let resolvedPlannerConversationId = plannerContext.plannerConversationId;
      if (!resolvedPlannerConversationId && plannerKnownIds) {
        resolvedPlannerConversationId =
          (await findSessionIdByCwd({
            cwd: plannerCwd,
            knownIds: plannerKnownIds,
          })) || "";
        if (!resolvedPlannerConversationId && plannerDecisionResult.plannerBranch === "new") {
          resolvedPlannerConversationId =
            (await findSessionIdByCwd({
              cwd: plannerCwd,
              knownIds: new Set<string>(),
            })) || "";
        }
        if (resolvedPlannerConversationId) {
          bindPlanPlannerConversation({
            key: planKey,
            plannerConversationId: resolvedPlannerConversationId,
          });
        }
      }

      const planStep = applyPlanDecision({
        key: planKey,
        decision: plannerDecisionResult.decision,
      });

      await fileLogger.log({
        ts: new Date().toISOString(),
        type: "plan_step",
        requestId,
        mode: "plan",
        stage: planStep.kind,
        questionSource: planStep.kind === "question" ? "model_planner" : undefined,
        plannerSessionId: resolvedPlannerConversationId || null,
        plannerBranch: plannerDecisionResult.plannerBranch,
        plannerLatencyMs: Date.now() - plannerStartedAt,
        planStage: planStep.progress.phase,
        planDecision: planStep.kind === "question" ? "ask_next" : "ready_to_plan",
        planBatchSize: planStep.kind === "question" ? 1 : 0,
        planRound: planStep.progress.round ?? 0,
        readyReason: plannerDecisionResult.decision.reason,
        conversationId: resolvedConversationId || null,
      });
      return createPlanSseResponse({
        result: planStep,
        conversationId: resolvedConversationId,
        model: payload.model,
        headers,
      });
    }

    const finalizeStep = finalizePlanSession({
      key: planKey,
      prompt: payload.input,
    });

    if (finalizeStep.kind !== "finalize") {
      await fileLogger.log({
        ts: new Date().toISOString(),
        type: "plan_step",
        requestId,
        mode: "plan",
        stage: finalizeStep.kind,
        questionSource: finalizeStep.kind === "question" ? "model_planner" : undefined,
        planStage: finalizeStep.progress.phase,
        planDecision: finalizeStep.kind === "question" ? "ask_next" : "ready_to_plan",
        planBatchSize: finalizeStep.kind === "question" ? 1 : 0,
        planRound: finalizeStep.progress.round ?? 0,
        conversationId: resolvedConversationId || null,
      });
      return createPlanSseResponse({
        result: finalizeStep,
        conversationId: resolvedConversationId,
        model: payload.model,
        headers,
      });
    }

    runtimeInput = finalizeStep.finalPrompt;
    isPlanFinalizeTurn = true;
    await fileLogger.log({
      ts: new Date().toISOString(),
      type: "plan_finalize",
      requestId,
      mode: "plan",
      planStage: "completed",
      planDecision: "finalized",
      conversationId: resolvedConversationId || null,
    });
  }

  const knownIds = !resolvedConversationId ? await listSessionIds() : new Set<string>();
  await fileLogger.log({
    ts: new Date().toISOString(),
    type: "branch_selected",
    requestId,
    branch: resolvedConversationId ? "resume" : "new",
    conversationId: resolvedConversationId || null,
    cwd: resolvedCwd,
    mode: payload.mode ?? "default",
    injectionProfile,
  });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let streamClosed = false;
      let enqueueAfterCloseBlocked = 0;
      let streamCloseReason: "done" | "error" | "abort" | "none" = "none";
      let emittedTokenCount = 0;

      const safeEnqueue = (event: string, data: unknown): boolean => {
        if (streamClosed) {
          enqueueAfterCloseBlocked += 1;
          return false;
        }
        try {
          enqueueSse(controller, event, data);
          return true;
        } catch {
          streamClosed = true;
          enqueueAfterCloseBlocked += 1;
          return false;
        }
      };

      const safeClose = (reason: "done" | "error" | "abort") => {
        if (!streamClosed) {
          streamCloseReason = reason;
          streamClosed = true;
          try {
            controller.close();
          } catch {
            // ignore close race
          }
          return;
        }
        if (streamCloseReason === "none") {
          streamCloseReason = reason;
        }
      };

      safeEnqueue("ready", {
        conversationId: resolvedConversationId || null,
        model: payload.model,
      });
      if (isPlanFinalizeTurn) {
        safeEnqueue("status", {
          phase: "planning_finalizing",
          detail: "正在生成最终计划",
        });
      }

      const run = resolvedConversationId
        ? codexRuntime.streamResumeSession(
            {
              conversationId: resolvedConversationId,
              model: payload.model,
              message: runtimeInput,
              cwd: resolvedCwd,
              sandbox: serverEnv.codexSandbox,
              mode: payload.mode,
              attachments: payload.attachments,
            },
            {
              signal: request.signal,
              onToken(token) {
                emittedTokenCount += token.length;
                safeEnqueue("token", { token });
              },
              onStatus(event) {
                safeEnqueue("status", event);
              },
              onTool(event) {
                safeEnqueue("tool", event);
              },
            },
          )
        : codexRuntime.streamNewSession(
            {
              model: payload.model,
              message: runtimeInput,
              cwd: resolvedCwd,
              sandbox: serverEnv.codexSandbox,
              mode: payload.mode,
              attachments: payload.attachments,
            },
            {
              signal: request.signal,
              onToken(token) {
                emittedTokenCount += token.length;
                safeEnqueue("token", { token });
              },
              onStatus(event) {
                safeEnqueue("status", event);
              },
              onTool(event) {
                safeEnqueue("tool", event);
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
        policyMode,
        mode: payload.mode ?? "default",
        injectionProfile,
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

          if (isPlanFinalizeTurn && emittedTokenCount === 0 && !result.aborted) {
            safeEnqueue("error", {
              code: "UPSTREAM_ERROR",
              message: "最终计划未返回内容，请重试。",
            });
            await fileLogger.log({
              ts: new Date().toISOString(),
              type: "stream_error",
              requestId,
              conversationId: resolvedConversationId || null,
              cwd: resolvedCwd,
              rawMessage: "plan_finalize_empty_output",
              mappedMessage: "最终计划未返回内容，请重试。",
              abortSource: "runtime_error",
              errorCategory: "finalize_empty_output",
              sandbox: serverEnv.codexSandbox,
              policyMode,
              enqueueAfterCloseBlocked,
            });
            safeClose("error");
            return;
          }

          safeEnqueue("done", {
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
            streamCloseReason: result.aborted ? "abort" : "done",
            enqueueAfterCloseBlocked,
          });
          safeClose(result.aborted ? "abort" : "done");
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
          const isPolicyBlocked =
            lowered.includes("blocked by policy") ||
            lowered.includes("approval settings") ||
            lowered.includes("rejected by user approval settings") ||
            lowered.includes("approval required");
          const message = lowered.includes("unexpected argument '--sandbox'")
            ? "恢复会话命令参数与当前 Codex CLI 版本不兼容，请重试或更新客户端参数。"
            : isCliVersionMismatch
              ? "本机 Codex CLI 版本与本地状态库不兼容，请升级 Codex CLI 后重试。"
              : isTimeoutError
                ? "本轮执行超时，请重试或缩短问题范围。"
                : isPolicyBlocked
                  ? "当前会话权限策略不允许写操作，请切换到可写或完全控制模式。"
            : request.signal.aborted
              ? "客户端连接已中断，可重试。"
            : rawMessage;
          safeEnqueue("error", {
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
                : isPolicyBlocked
                  ? "policy_blocked"
              : "general_upstream_error",
            sandbox: serverEnv.codexSandbox,
            policyMode,
            streamCloseReason,
            enqueueAfterCloseBlocked,
          });
          safeClose(request.signal.aborted ? "abort" : "error");
        });
    },
  });

  return new Response(stream, { headers });
}
