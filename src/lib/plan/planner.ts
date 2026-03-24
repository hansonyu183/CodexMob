import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import type { CodexRuntimeAdapter } from "@/lib/codex/runtime";
import type { PlanQuestion } from "@/lib/types";
import type { PlanDecision, PlanSessionContext } from "@/lib/plan/state";

interface ResolvePlanDecisionInput {
  runtime: CodexRuntimeAdapter;
  model: string;
  plannerCwd: string;
  context: PlanSessionContext;
  plannerConversationId?: string;
  signal?: AbortSignal;
}

export interface ResolvedPlanDecision {
  decision: PlanDecision;
  plannerBranch: "new" | "resume";
}

interface PlannerOutput {
  decision?: string;
  reason?: string;
  question?: {
    id?: string;
    prompt?: string;
    allowNote?: boolean;
    options?: Array<{
      value?: string;
      label?: string;
      description?: string;
      recommended?: boolean;
    }>;
  };
}

interface PlannerRawOption {
  value?: string;
  label?: string;
  description?: string;
  recommended?: boolean;
}

function truncate(text: string, max = 3000): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n...[truncated]`;
}

function toHistoryText(context: PlanSessionContext): string {
  if (context.history.length === 0) {
    return "(none)";
  }
  return context.history
    .map((item, index) => {
      const note = item.note ? ` | note: ${item.note}` : "";
      return `${index + 1}. ${item.questionPrompt} => ${item.option}${note}`;
    })
    .join("\n");
}

function buildPlannerPrompt(context: PlanSessionContext): string {
  const schema = [
    '{"decision":"ask_next","reason":"...","question":{"id":"...","prompt":"...","allowNote":true,"options":[{"value":"...","label":"...","description":"...","recommended":true}]}}',
    '{"decision":"ready_to_plan","reason":"..."}',
  ].join("\n");

  return [
    "You are a planning orchestrator for Codex web plan mode.",
    "Goal: ask context-aware clarification questions one at a time, then mark ready when enough info is collected.",
    "",
    "Strict rules:",
    "- Return JSON only. No markdown, no prose.",
    "- decision must be ask_next or ready_to_plan.",
    "- If ask_next: include exactly one question with 2-4 mutually exclusive options.",
    "- Options must include exactly one recommended=true.",
    "- Question must be grounded in original prompt, discovery summary, and answered history.",
    "- Do NOT repeat already-answered dimensions.",
    "- If info is sufficient, return ready_to_plan.",
    "",
    "Output JSON examples:",
    schema,
    "",
    "Current context:",
    `- round: ${context.round}`,
    `- answeredCount: ${context.answeredCount}`,
    `- originalPrompt: ${truncate(context.originalPrompt, 1200)}`,
    `- latestUserInput: ${truncate(context.latestPrompt, 800)}`,
    `- discoverySummary: ${truncate(context.discoverySummary || "(none)", 1200)}`,
    "- answeredHistory:",
    toHistoryText(context),
  ].join("\n");
}

function extractJsonPayload(text: string): PlannerOutput {
  const trimmed = text.trim();

  const tryParse = (raw: string): PlannerOutput | null => {
    try {
      const parsed = JSON.parse(raw) as PlannerOutput;
      if (typeof parsed === "object" && parsed !== null) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  };

  const direct = tryParse(trimmed);
  if (direct) {
    return direct;
  }

  const fenced = trimmed.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    const fromFence = tryParse(fenced[1].trim());
    if (fromFence) {
      return fromFence;
    }
  }

  const firstObjStart = trimmed.indexOf("{");
  const lastObjEnd = trimmed.lastIndexOf("}");
  if (firstObjStart >= 0 && lastObjEnd > firstObjStart) {
    const fromSlice = tryParse(trimmed.slice(firstObjStart, lastObjEnd + 1));
    if (fromSlice) {
      return fromSlice;
    }
  }

  throw new Error("PLANNER_INVALID_JSON");
}

function normalizeOptions(raw?: PlannerRawOption[]): PlanQuestion["options"] {
  const normalized = (raw ?? [])
    .map((item: PlannerRawOption, index: number) => ({
      value: (item?.value ?? "").trim() || `option_${index + 1}`,
      label: (item?.label ?? "").trim(),
      description: (item?.description ?? "").trim(),
      recommended: item?.recommended === true,
    }))
    .filter((item: { label: string; description: string }) => item.label && item.description)
    .slice(0, 4);

  if (normalized.length === 0) {
    return [
      {
        value: "best_practice",
        label: "按最佳实践推进",
        description: "基于当前上下文给出推荐方案。",
        recommended: true,
      },
      {
        value: "customize",
        label: "我补充细节后再定",
        description: "先补充关键约束再继续。",
      },
    ];
  }

  if (normalized.length === 1) {
    normalized.push({
      value: "other",
      label: "其他",
      description: "我有不同选择或补充。",
      recommended: false,
    });
  }

  let recommendedSet = false;
  for (const option of normalized) {
    if (!recommendedSet && option.recommended) {
      recommendedSet = true;
      continue;
    }
    if (recommendedSet) {
      option.recommended = false;
    }
  }
  if (!recommendedSet) {
    normalized[0].recommended = true;
  }

  return normalized;
}

function normalizeQuestionId(prompt: string, incomingId?: string): string {
  const raw = (incomingId ?? "").trim();
  if (raw) {
    return raw;
  }

  const base = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  const hash = createHash("sha1").update(prompt).digest("hex").slice(0, 6);
  return `${base || "plan_question"}_${hash}`;
}

function normalizeDecision(output: PlannerOutput): PlanDecision {
  const decision = (output.decision ?? "").trim().toLowerCase();
  const reason = typeof output.reason === "string" ? output.reason.trim() : "";

  if (decision === "ready_to_plan" || decision === "ready") {
    return {
      kind: "ready_to_plan",
      reason: reason || "context_sufficient",
    };
  }

  const prompt = (output.question?.prompt ?? "").trim();
  if (!prompt) {
    throw new Error("PLANNER_MISSING_QUESTION");
  }

  return {
    kind: "ask_next",
    reason: reason || "need_more_context",
    question: {
      id: normalizeQuestionId(prompt, output.question?.id),
      prompt,
      allowNote: output.question?.allowNote !== false,
      options: normalizeOptions(output.question?.options),
    },
  };
}

function buildFallbackQuestion(context: PlanSessionContext): PlanQuestion {
  const promptText = `${context.originalPrompt}\n${context.latestPrompt}`.toLowerCase();
  if (promptText.includes("skill") || promptText.includes("sop")) {
    return {
      id: "skill_goal_focus",
      prompt: "这次 skill 交付你更希望先锁定哪一项？",
      allowNote: true,
      options: [
        {
          value: "boundary_first",
          label: "先锁边界拆分",
          description: "先定义 skill + SOP 的拆分边界。",
          recommended: true,
        },
        {
          value: "question_flow_first",
          label: "先锁引导问题流",
          description: "先定义面对小白的提问链路。",
        },
        {
          value: "artifact_first",
          label: "先锁交付产物",
          description: "先明确最终要产出的文件与结构。",
        },
      ],
    };
  }

  return {
    id: "task_goal_focus",
    prompt: "为了先收敛方案，这轮你最优先锁定哪项？",
    allowNote: true,
    options: [
      {
        value: "scope",
        label: "范围边界",
        description: "先确认做哪些与不做哪些。",
        recommended: true,
      },
      {
        value: "acceptance",
        label: "验收标准",
        description: "先定义可验收结果。",
      },
      {
        value: "risk",
        label: "风险约束",
        description: "先锁风险与限制条件。",
      },
    ],
  };
}

function ensurePlannerCwd(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    throw new Error("PLANNER_CWD_MISSING");
  }
  mkdirSync(trimmed, { recursive: true });
  return trimmed;
}

export async function resolvePlanDecisionViaCli(
  input: ResolvePlanDecisionInput,
): Promise<ResolvedPlanDecision> {
  const plannerPrompt = buildPlannerPrompt(input.context);
  const cwd = ensurePlannerCwd(input.plannerCwd);
  const branch: "new" | "resume" = input.plannerConversationId ? "resume" : "new";

  let lastError: unknown;
  let latestReadyDecision: PlanDecision | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = input.plannerConversationId
        ? await input.runtime.streamResumeSession(
            {
              conversationId: input.plannerConversationId,
              model: input.model,
              message: plannerPrompt,
              cwd,
              sandbox: "read-only",
              mode: "default",
            },
            {
              signal: input.signal,
              onToken() {
                // planner result parsed from final text
              },
            },
          )
        : await input.runtime.streamNewSession(
            {
              model: input.model,
              message: plannerPrompt,
              cwd,
              sandbox: "read-only",
              mode: "default",
            },
            {
              signal: input.signal,
              onToken() {
                // planner result parsed from final text
              },
            },
          );

      const output = extractJsonPayload(result.text);
      const decision = normalizeDecision(output);
      if (decision.kind === "ready_to_plan" && input.context.answeredCount < 1) {
        latestReadyDecision = decision;
        continue;
      }
      return {
        decision,
        plannerBranch: branch,
      };
    } catch (error) {
      lastError = error;
    }
  }

  if (latestReadyDecision && input.context.answeredCount < 1) {
    return {
      decision: {
        kind: "ask_next",
        reason: "force_first_question_before_ready",
        question: buildFallbackQuestion(input.context),
      },
      plannerBranch: branch,
    };
  }

  const message = lastError instanceof Error ? lastError.message : "planner_failed";
  throw new Error(`PLANNER_DECISION_FAILED:${message}`);
}

export function resolvePlannerCwd(codexHome: string, fallbackCwd: string): string {
  const home = codexHome.trim();
  if (home) {
    return join(home, "worktrees", "codexmob-plan");
  }
  return fallbackCwd;
}
