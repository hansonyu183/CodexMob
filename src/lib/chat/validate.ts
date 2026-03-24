import type { ChatRequestPayload } from "@/lib/types";

export function validateChatPayload(input: unknown): ChatRequestPayload | null {
  if (typeof input !== "object" || input === null) {
    return null;
  }

  const raw = input as Record<string, unknown>;

  if (typeof raw.model !== "string" || !raw.model.trim()) {
    return null;
  }

  if (typeof raw.input !== "string" || !raw.input.trim()) {
    return null;
  }

  const payload: ChatRequestPayload = {
    model: raw.model.trim(),
    input: raw.input.trim(),
  };

  if (typeof raw.conversationId === "string" && raw.conversationId.trim()) {
    payload.conversationId = raw.conversationId.trim();
  }

  if (typeof raw.planSessionId === "string" && raw.planSessionId.trim()) {
    payload.planSessionId = raw.planSessionId.trim();
  }

  if (typeof raw.cwd === "string" && raw.cwd.trim()) {
    payload.cwd = raw.cwd.trim();
  }

  if (raw.mode === "default" || raw.mode === "plan") {
    payload.mode = raw.mode;
  }

  if (typeof raw.planAnswer === "object" && raw.planAnswer !== null) {
    const answer = raw.planAnswer as Record<string, unknown>;
    if (
      typeof answer.questionId !== "string" ||
      !answer.questionId.trim() ||
      typeof answer.option !== "string" ||
      !answer.option.trim()
    ) {
      return null;
    }
    payload.planAnswer = {
      questionId: answer.questionId.trim(),
      option: answer.option.trim(),
      note:
        typeof answer.note === "string" && answer.note.trim()
          ? answer.note.trim()
          : undefined,
    };
  }

  if (Array.isArray(raw.planAnswers)) {
    const answers: NonNullable<ChatRequestPayload["planAnswers"]> = [];
    for (const row of raw.planAnswers) {
      if (typeof row !== "object" || row === null) {
        return null;
      }
      const answer = row as Record<string, unknown>;
      if (
        typeof answer.questionId !== "string" ||
        !answer.questionId.trim() ||
        typeof answer.option !== "string" ||
        !answer.option.trim()
      ) {
        return null;
      }
      answers.push({
        questionId: answer.questionId.trim(),
        option: answer.option.trim(),
        note:
          typeof answer.note === "string" && answer.note.trim()
            ? answer.note.trim()
            : undefined,
      });
    }
    payload.planAnswers = answers;
  }

  if (Array.isArray(raw.attachments)) {
    const next: NonNullable<ChatRequestPayload["attachments"]> = [];
    for (const row of raw.attachments) {
      if (typeof row !== "object" || row === null) {
        return null;
      }
      const item = row as Record<string, unknown>;
      if (
        typeof item.id !== "string" ||
        !item.id.trim() ||
        typeof item.name !== "string" ||
        !item.name.trim() ||
        typeof item.path !== "string" ||
        !item.path.trim() ||
        (item.kind !== "image" && item.kind !== "text") ||
        typeof item.size !== "number" ||
        item.size < 0
      ) {
        return null;
      }
      next.push({
        id: item.id.trim(),
        name: item.name.trim(),
        path: item.path.trim(),
        kind: item.kind,
        size: item.size,
      });
    }
    payload.attachments = next;
  }

  return payload;
}
