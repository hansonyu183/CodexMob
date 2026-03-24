import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { PlanAnswer, PlanProgress, PlanQuestion } from "@/lib/types";

type PlanPhase = "discovering" | "clarifying" | "ready_to_plan" | "completed";

interface PlanHistoryItem {
  questionId: string;
  questionPrompt: string;
  option: string;
  note?: string;
}

interface PlanSession {
  key: string;
  cwd: string;
  phase: PlanPhase;
  originalPrompt: string;
  round: number;
  answeredCount: number;
  history: PlanHistoryItem[];
  currentQuestion: PlanQuestion | null;
  discovery: string[];
  discoverySummary: string;
  plannerConversationId: string;
  plannerWarm: boolean;
  updatedAt: number;
}

export interface PlanSessionInput {
  key: string;
  cwd: string;
  prompt: string;
  answer?: PlanAnswer;
}

export interface PlanSessionContext {
  key: string;
  cwd: string;
  originalPrompt: string;
  latestPrompt: string;
  discovery: string[];
  discoverySummary: string;
  round: number;
  answeredCount: number;
  history: PlanHistoryItem[];
  plannerConversationId?: string;
  plannerWarm: boolean;
}

export type PlanDecision =
  | {
      kind: "ask_next";
      question: PlanQuestion;
      reason?: string;
    }
  | {
      kind: "ready_to_plan";
      reason?: string;
    };

export type PlanSessionResult =
  | { kind: "question"; question: PlanQuestion; progress: PlanProgress }
  | { kind: "ready"; progress: PlanProgress }
  | { kind: "finalize"; finalPrompt: string; progress: PlanProgress };

interface DiscoveryResult {
  steps: string[];
  summary: string;
}

const sessions = new Map<string, PlanSession>();
const LEGACY_BASE_ROUNDS = 5;

function safeReadSnippet(path: string, maxChars = 500): string {
  try {
    if (!existsSync(path)) {
      return "";
    }
    const content = readFileSync(path, "utf8").trim();
    return content.slice(0, maxChars);
  } catch {
    return "";
  }
}

function safeList(path: string, maxItems = 8): string[] {
  try {
    if (!existsSync(path)) {
      return [];
    }
    return readdirSync(path).slice(0, maxItems);
  } catch {
    return [];
  }
}

function runDiscovery(cwd: string): DiscoveryResult {
  const agentsPath = join(cwd, "AGENTS.md");
  const readmePath = join(cwd, "README.md");
  const templatesPath = join(cwd, "templates");
  const scriptsPath = join(cwd, "scripts");
  const specPath = join(cwd, "Specification.md");

  const steps: string[] = [];
  const summaryParts: string[] = [];

  const agentsSnippet = safeReadSnippet(agentsPath, 400);
  if (agentsSnippet) {
    steps.push("读取 AGENTS 规则");
    summaryParts.push(`AGENTS: ${agentsSnippet}`);
  } else {
    steps.push("未发现 AGENTS，跳过");
  }

  const readmeSnippet = safeReadSnippet(readmePath, 400);
  if (readmeSnippet) {
    steps.push("读取 README 摘要");
    summaryParts.push(`README: ${readmeSnippet}`);
  } else {
    steps.push("未发现 README，跳过");
  }

  const templateItems = safeList(templatesPath, 10);
  if (templateItems.length > 0) {
    steps.push("扫描 templates 目录");
    summaryParts.push(`templates: ${templateItems.join(", ")}`);
  } else {
    steps.push("未发现 templates，跳过");
  }

  const scriptItems = safeList(scriptsPath, 10);
  if (scriptItems.length > 0) {
    steps.push("扫描 scripts 目录");
    summaryParts.push(`scripts: ${scriptItems.join(", ")}`);
  } else {
    steps.push("未发现 scripts，跳过");
  }

  const specSnippet = safeReadSnippet(specPath, 400);
  if (specSnippet) {
    steps.push("读取 Specification 摘要");
    summaryParts.push(`spec: ${specSnippet}`);
  } else {
    steps.push("未发现 Specification，跳过");
  }

  return {
    steps,
    summary: summaryParts.join("\n"),
  };
}

function initializeSession(input: PlanSessionInput): PlanSession {
  const discovery = runDiscovery(input.cwd);
  const session: PlanSession = {
    key: input.key,
    cwd: input.cwd,
    phase: "discovering",
    originalPrompt: input.prompt,
    round: 0,
    answeredCount: 0,
    history: [],
    currentQuestion: null,
    discovery: discovery.steps,
    discoverySummary: discovery.summary,
    plannerConversationId: "",
    plannerWarm: false,
    updatedAt: Date.now(),
  };
  sessions.set(input.key, session);
  return session;
}

function summarizeHistory(history: PlanHistoryItem[]): string {
  if (history.length === 0) {
    return "尚未收集到澄清信息";
  }
  return history
    .slice(-8)
    .map((row) => `${row.questionId}:${row.option}${row.note ? `(${row.note})` : ""}`)
    .join("；");
}

function toProgress(session: PlanSession): PlanProgress {
  return {
    phase: session.phase,
    answered: session.answeredCount,
    total: Math.max(LEGACY_BASE_ROUNDS, session.answeredCount),
    summary: summarizeHistory(session.history),
    round: session.round,
    answeredCount: session.answeredCount,
    batchSize: session.currentQuestion ? 1 : 0,
    minQuestions: 1,
    maxQuestions: 1,
    baseRounds: LEGACY_BASE_ROUNDS,
    isSupplementalRound: session.round > LEGACY_BASE_ROUNDS,
    discovery: session.discovery,
  };
}

function transitionFromDiscovering(session: PlanSession) {
  if (session.phase === "discovering") {
    session.phase = "clarifying";
  }
}

function applyAnswer(session: PlanSession, answer: PlanAnswer) {
  if (!session.currentQuestion || session.currentQuestion.id !== answer.questionId) {
    throw new Error("PLAN_ANSWER_MISMATCH");
  }

  session.history.push({
    questionId: session.currentQuestion.id,
    questionPrompt: session.currentQuestion.prompt,
    option: answer.option,
    note: answer.note?.trim() || undefined,
  });
  session.answeredCount = session.history.length;
}

function normalizeQuestion(input: PlanQuestion): PlanQuestion {
  const prompt = input.prompt.trim();
  const id = input.id.trim();
  const options = input.options
    .map((item) => ({
      value: item.value.trim(),
      label: item.label.trim(),
      description: item.description.trim(),
      recommended: item.recommended === true,
    }))
    .filter((item) => item.value && item.label && item.description)
    .slice(0, 4);

  if (!id || !prompt || options.length < 2) {
    throw new Error("INVALID_PLAN_QUESTION");
  }

  if (!options.some((item) => item.recommended)) {
    options[0] = {
      ...options[0],
      recommended: true,
    };
  }

  return {
    id,
    prompt,
    allowNote: input.allowNote !== false,
    options,
  };
}

function buildFinalPrompt(session: PlanSession, latestPrompt: string): string {
  const lines = session.history.map((item, idx) => {
    const noteLine = item.note ? `\n   - 补充: ${item.note}` : "";
    return `${idx + 1}. 问题: ${item.questionPrompt}\n   - 选择: ${item.option}${noteLine}`;
  });

  return [
    "请基于以下澄清结果，输出一个决策完整的实施计划。",
    "要求：仅输出一个 <proposed_plan> 块。",
    "",
    "原始问题：",
    session.originalPrompt,
    "",
    "探索摘要：",
    session.discoverySummary || "（无可用探索摘要）",
    "",
    "澄清结果：",
    ...lines,
    "",
    "本轮补充：",
    latestPrompt,
  ].join("\n");
}

export function hasPlanSession(key: string): boolean {
  return sessions.has(key);
}

export function buildPlanSessionKey(input: {
  conversationId?: string;
  planSessionId?: string;
  cwd: string;
  model: string;
}): string {
  if (input.conversationId?.trim()) {
    return `conv:${input.conversationId.trim()}`;
  }
  if (input.planSessionId?.trim()) {
    return `plan:${input.planSessionId.trim()}`;
  }
  return "";
}

export function preparePlanSessionTurn(input: PlanSessionInput): {
  context: PlanSessionContext;
  progress: PlanProgress;
} {
  const session = sessions.get(input.key) ?? initializeSession(input);
  session.updatedAt = Date.now();
  transitionFromDiscovering(session);

  if (input.answer) {
    applyAnswer(session, input.answer);
  }

  return {
    context: {
      key: session.key,
      cwd: session.cwd,
      originalPrompt: session.originalPrompt,
      latestPrompt: input.prompt,
      discovery: session.discovery,
      discoverySummary: session.discoverySummary,
      round: session.round,
      answeredCount: session.answeredCount,
      history: [...session.history],
      plannerConversationId: session.plannerConversationId || undefined,
      plannerWarm: session.plannerWarm,
    },
    progress: toProgress(session),
  };
}

export function bindPlanPlannerConversation(input: {
  key: string;
  plannerConversationId: string;
}) {
  const session = sessions.get(input.key);
  if (!session) {
    return;
  }
  const id = input.plannerConversationId.trim();
  if (!id) {
    return;
  }
  session.plannerConversationId = id;
  session.plannerWarm = true;
  session.updatedAt = Date.now();
}

export function applyPlanDecision(input: {
  key: string;
  decision: PlanDecision;
}): PlanSessionResult {
  const session = sessions.get(input.key);
  if (!session) {
    return {
      kind: "ready",
      progress: {
        phase: "clarifying",
        answered: 0,
        total: LEGACY_BASE_ROUNDS,
        summary: "缺少计划上下文，请先重新开始计划模式。",
      },
    };
  }

  if (input.decision.kind === "ready_to_plan") {
    session.phase = "ready_to_plan";
    session.currentQuestion = null;
    return {
      kind: "ready",
      progress: toProgress(session),
    };
  }

  const question = normalizeQuestion(input.decision.question);
  session.currentQuestion = question;
  session.round += 1;
  session.phase = "clarifying";

  return {
    kind: "question",
    question,
    progress: toProgress(session),
  };
}

export function finalizePlanSession(input: { key: string; prompt: string }): PlanSessionResult {
  const session = sessions.get(input.key);
  if (!session) {
    return {
      kind: "ready",
      progress: {
        phase: "clarifying",
        answered: 0,
        total: LEGACY_BASE_ROUNDS,
        summary: "缺少计划上下文，请先完成澄清。",
      },
    };
  }

  if (session.phase !== "ready_to_plan") {
    if (session.currentQuestion) {
      return {
        kind: "question",
        question: session.currentQuestion,
        progress: toProgress(session),
      };
    }
    return {
      kind: "ready",
      progress: toProgress(session),
    };
  }

  session.phase = "completed";
  const finalPrompt = buildFinalPrompt(session, input.prompt);
  const completedProgress = {
    ...toProgress(session),
    phase: "completed",
  };
  sessions.delete(input.key);

  return {
    kind: "finalize",
    finalPrompt,
    progress: completedProgress,
  };
}

export function resetPlanSessionsForTests() {
  sessions.clear();
}
