import { beforeEach, describe, expect, it } from "vitest";

import {
  applyPlanDecision,
  buildPlanSessionKey,
  finalizePlanSession,
  hasPlanSession,
  preparePlanSessionTurn,
  resetPlanSessionsForTests,
  type PlanDecision,
} from "@/lib/plan/state";

function askQuestionDecision(id: string, prompt: string): PlanDecision {
  return {
    kind: "ask_next",
    reason: "need_more_context",
    question: {
      id,
      prompt,
      allowNote: true,
      options: [
        {
          value: "a",
          label: "选项A",
          description: "desc A",
          recommended: true,
        },
        {
          value: "b",
          label: "选项B",
          description: "desc B",
        },
      ],
    },
  };
}

describe("plan session state", () => {
  beforeEach(() => {
    resetPlanSessionsForTests();
  });

  it("creates isolated session context by planSessionId", () => {
    const keyA = buildPlanSessionKey({
      planSessionId: "plan-a",
      cwd: "D:\\code\\CodexMob",
      model: "gpt-5.3-codex",
    });
    const keyB = buildPlanSessionKey({
      planSessionId: "plan-b",
      cwd: "D:\\code\\CodexMob",
      model: "gpt-5.3-codex",
    });

    const turnA = preparePlanSessionTurn({
      key: keyA,
      cwd: "D:\\code\\CodexMob",
      prompt: "做技能计划A",
    });
    const turnB = preparePlanSessionTurn({
      key: keyB,
      cwd: "D:\\code\\CodexMob",
      prompt: "做技能计划B",
    });

    expect(turnA.context.originalPrompt).toContain("A");
    expect(turnB.context.originalPrompt).toContain("B");
    expect(turnA.context.key).not.toBe(turnB.context.key);
  });

  it("applies ask_next decision and requires matching answer", () => {
    const key = buildPlanSessionKey({
      planSessionId: "plan-c",
      cwd: "D:\\code\\CodexMob",
      model: "gpt-5.3-codex",
    });

    preparePlanSessionTurn({
      key,
      cwd: "D:\\code\\CodexMob",
      prompt: "创建 skill 计划",
    });

    const step = applyPlanDecision({
      key,
      decision: askQuestionDecision("q1", "你希望输出到哪一层？"),
    });

    expect(step.kind).toBe("question");
    if (step.kind !== "question") {
      return;
    }

    expect(step.question.id).toBe("q1");
    expect(step.progress.round).toBe(1);

    expect(() =>
      preparePlanSessionTurn({
        key,
        cwd: "D:\\code\\CodexMob",
        prompt: "继续",
        answer: {
          questionId: "wrong",
          option: "a",
        },
      }),
    ).toThrowError("PLAN_ANSWER_MISMATCH");

    const nextTurn = preparePlanSessionTurn({
      key,
      cwd: "D:\\code\\CodexMob",
      prompt: "继续",
      answer: {
        questionId: "q1",
        option: "a",
        note: "补充内容",
      },
    });

    expect(nextTurn.context.answeredCount).toBe(1);
  });

  it("moves to ready_to_plan and finalizes prompt", () => {
    const key = buildPlanSessionKey({
      planSessionId: "plan-d",
      cwd: "D:\\code\\CodexMob",
      model: "gpt-5.3-codex",
    });

    preparePlanSessionTurn({
      key,
      cwd: "D:\\code\\CodexMob",
      prompt: "请做改造计划",
    });

    applyPlanDecision({
      key,
      decision: askQuestionDecision("q1", "优先目标是什么？"),
    });

    preparePlanSessionTurn({
      key,
      cwd: "D:\\code\\CodexMob",
      prompt: "继续",
      answer: {
        questionId: "q1",
        option: "a",
      },
    });

    const ready = applyPlanDecision({
      key,
      decision: {
        kind: "ready_to_plan",
        reason: "context_sufficient",
      },
    });

    expect(ready.kind).toBe("ready");

    const finalize = finalizePlanSession({
      key,
      prompt: "输出最终计划",
    });
    expect(finalize.kind).toBe("finalize");
    if (finalize.kind === "finalize") {
      expect(finalize.finalPrompt).toContain("原始问题");
      expect(finalize.finalPrompt).toContain("澄清结果");
    }
    expect(hasPlanSession(key)).toBe(false);
  });
});
