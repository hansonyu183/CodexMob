"use client";

import type { HistoryConversation, HistoryMessage, SyncRunResponse } from "@/lib/types";

async function fetchJson<T>(url: string, accessCode: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-app-access-code": accessCode,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function runHistorySync(
  accessCode: string,
  mode: "startup" | "manual",
  cwdFilter?: string,
): Promise<SyncRunResponse> {
  return fetchJson<SyncRunResponse>("/api/history/sync/run", accessCode, {
    method: "POST",
    body: JSON.stringify({ mode, cwdFilter }),
  });
}

export async function loadHistoryConversations(accessCode: string): Promise<HistoryConversation[]> {
  const result = await fetchJson<{ items: HistoryConversation[] }>(
    "/api/history/conversations?limit=200",
    accessCode,
  );
  return result.items;
}

export async function createHistoryConversation(
  accessCode: string,
  input: { id?: string; title: string; model?: string; cwd?: string },
): Promise<HistoryConversation> {
  return fetchJson<HistoryConversation>("/api/history/conversations", accessCode, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function loadHistoryMessages(
  accessCode: string,
  conversationId: string,
): Promise<HistoryMessage[]> {
  const result = await fetchJson<{ items: HistoryMessage[] }>(
    `/api/history/conversations/${conversationId}/messages`,
    accessCode,
  );
  return result.items;
}

export async function appendHistoryMessageRemote(
  accessCode: string,
  conversationId: string,
  payload: {
    role: "user" | "assistant" | "system";
    content: string;
  },
): Promise<{ accepted: boolean; newRev: number }> {
  return fetchJson(`/api/history/conversations/${conversationId}/messages`, accessCode, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
