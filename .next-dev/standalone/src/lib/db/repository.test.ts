import { beforeEach, describe, expect, it } from "vitest";

import {
  closeDbForTests,
  deleteConversation,
  getSettings,
  listConversations,
  listMessages,
  putMessage,
  resetDbForTests,
  saveSettings,
  upsertConversation,
} from "@/lib/db/repository";
import type { AppSettings, Conversation, Message } from "@/lib/types";

function deleteDb(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Delete DB blocked"));
    request.onsuccess = () => resolve();
  });
}

describe("db repository", () => {
  beforeEach(async () => {
    await closeDbForTests();
    await deleteDb("codex-mob");
    resetDbForTests();
  });

  it("stores and sorts conversations by updated time", async () => {
    const a: Conversation = {
      id: "a",
      title: "A",
      model: "gpt-5.4",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const b: Conversation = {
      id: "b",
      title: "B",
      model: "gpt-5.4",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    };

    await upsertConversation(a);
    await upsertConversation(b);

    const rows = await listConversations();
    expect(rows.map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("cascades messages when deleting a conversation", async () => {
    await upsertConversation({
      id: "c1",
      title: "conversation",
      model: "gpt-5.4",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const message: Message = {
      id: "m1",
      conversationId: "c1",
      role: "user",
      content: "hello",
      createdAt: "2026-01-01T00:00:00.000Z",
      status: "done",
    };

    await putMessage(message);
    await deleteConversation("c1");

    const rows = await listMessages("c1");
    expect(rows).toHaveLength(0);
  });

  it("persists settings", async () => {
    const defaults: AppSettings = {
      theme: "dark",
      defaultModel: "gpt-5.4",
      accessCode: "",
    };

    await saveSettings({
      theme: "light",
      defaultModel: "gpt-5.3-codex",
      accessCode: "secret",
    });

    const rows = await getSettings(defaults);
    expect(rows.theme).toBe("light");
    expect(rows.defaultModel).toBe("gpt-5.3-codex");
    expect(rows.accessCode).toBe("secret");
  });
});
