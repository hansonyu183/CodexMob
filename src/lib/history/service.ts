import { nanoid } from "nanoid";

import type { HistoryConversation, HistoryMessage, SyncRunResponse } from "@/lib/types";
import {
  appendNativeMessage,
  createNativeConversation,
  readSessionIndexRows,
  readSessionMeta,
  readCodexHistory,
  renameNativeConversation,
  resolveSessionFile,
} from "@/lib/history/codex-history";
import { withConversationLock } from "@/lib/history/lock";

interface UnifiedHistory {
  conversations: HistoryConversation[];
  messages: HistoryMessage[];
}

export async function getUnifiedHistory(input?: { cwdFilter?: string }): Promise<UnifiedHistory> {
  return readCodexHistory({
    cwdFilter: input?.cwdFilter,
  });
}

export async function runSync(input?: { cwdFilter?: string }): Promise<SyncRunResponse> {
  const startedAt = Date.now();
  const history = await getUnifiedHistory({
    cwdFilter: input?.cwdFilter,
  });

  return {
    syncedSessions: history.conversations.length,
    syncedMessages: history.messages.length,
    latestRev: 0,
    durationMs: Date.now() - startedAt,
  };
}

export async function listHistoryConversations(input: {
  cursor?: string;
  limit?: number;
}): Promise<{ items: HistoryConversation[]; nextCursor?: string }> {
  const history = await getUnifiedHistory();
  const limit = Math.max(1, Math.min(input.limit ?? 50, 200));

  const offset = input.cursor
    ? Number.parseInt(Buffer.from(input.cursor, "base64url").toString("utf8"), 10)
    : 0;
  const safeOffset = Number.isFinite(offset) ? Math.max(0, offset) : 0;

  const items = history.conversations.slice(safeOffset, safeOffset + limit);
  const nextOffset = safeOffset + items.length;
  const nextCursor =
    nextOffset < history.conversations.length
      ? Buffer.from(String(nextOffset), "utf8").toString("base64url")
      : undefined;

  return {
    items,
    nextCursor,
  };
}

export async function listHistoryMessages(conversationId: string): Promise<HistoryMessage[]> {
  const history = await getUnifiedHistory();
  return history.messages.filter((item) => item.conversationId === conversationId);
}

export async function upsertNativeConversation(input: {
  id?: string;
  title: string;
  model?: string;
  cwd?: string;
}): Promise<HistoryConversation> {
  const conversationId = input.id ?? nanoid();
  const title = input.title.trim() || "新会话";

  return withConversationLock(conversationId, async () => {
    const existing = await resolveSessionFile(conversationId);
    if (existing) {
      await renameNativeConversation(conversationId, title);
    } else {
      await createNativeConversation({
        id: conversationId,
        title,
        model: input.model,
        cwd: input.cwd,
      });
    }

    const history = await getUnifiedHistory();
    const conversation = history.conversations.find((item) => item.id === conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found after upsert.`);
    }
    return conversation;
  });
}

export async function appendHistoryMessage(input: {
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
}): Promise<{ accepted: boolean; newRev: number }> {
  return withConversationLock(input.conversationId, async () => {
    await appendNativeMessage({
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
    });

    return {
      accepted: true,
      newRev: 0,
    };
  });
}

export async function getConversationMeta(input: {
  conversationId: string;
}): Promise<{
  id: string;
  cwd: string | null;
  model?: string;
} | null> {
  return readSessionMeta(input.conversationId);
}

function normalizePath(input: string): string {
  const normalized = input.replaceAll("\\", "/").replace(/\/+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export async function listSessionIds(): Promise<Set<string>> {
  const rows = await readSessionIndexRows();
  return new Set(rows.map((item) => item.id));
}

export async function findSessionIdByCwd(input: {
  cwd: string;
  knownIds: Set<string>;
}): Promise<string | null> {
  const rows = await readSessionIndexRows();
  const target = normalizePath(input.cwd);

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    const meta = await readSessionMeta(row.id);
    const cwd = meta?.cwd ? normalizePath(meta.cwd) : "";
    if (!cwd || cwd !== target) {
      continue;
    }
    if (!input.knownIds.has(row.id)) {
      return row.id;
    }
  }

  return null;
}
