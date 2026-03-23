import { openDB, type DBSchema, type IDBPDatabase } from "idb";

import type { AppSettings, Conversation, Message } from "@/lib/types";

interface SettingsRow {
  key: "app";
  value: AppSettings;
}

interface CodexMobSchema extends DBSchema {
  conversations: {
    key: string;
    value: Conversation;
  };
  messages: {
    key: string;
    value: Message;
    indexes: {
      byConversation: string;
      byConversationAndCreatedAt: [string, string];
    };
  };
  settings: {
    key: SettingsRow["key"];
    value: SettingsRow;
  };
}

const DB_NAME = "codex-mob";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<CodexMobSchema>> | null = null;

function getDb(): Promise<IDBPDatabase<CodexMobSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<CodexMobSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("conversations")) {
          db.createObjectStore("conversations", { keyPath: "id" });
        }

        if (!db.objectStoreNames.contains("messages")) {
          const store = db.createObjectStore("messages", { keyPath: "id" });
          store.createIndex("byConversation", "conversationId");
          store.createIndex("byConversationAndCreatedAt", [
            "conversationId",
            "createdAt",
          ]);
        }

        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "key" });
        }
      },
    });
  }

  return dbPromise;
}

export function guessConversationTitle(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "新会话";
  }

  return normalized.length > 24 ? `${normalized.slice(0, 24)}...` : normalized;
}

export async function listConversations(): Promise<Conversation[]> {
  const db = await getDb();
  const list = await db.getAll("conversations");
  return list.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function upsertConversation(conversation: Conversation): Promise<void> {
  const db = await getDb();
  await db.put("conversations", conversation);
}

export async function deleteConversation(conversationId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["conversations", "messages"], "readwrite");
  await tx.objectStore("conversations").delete(conversationId);

  const index = tx.objectStore("messages").index("byConversation");
  let cursor = await index.openCursor(conversationId);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }

  await tx.done;
}

export async function listMessages(conversationId: string): Promise<Message[]> {
  const db = await getDb();
  const rows = await db.getAllFromIndex("messages", "byConversation", conversationId);
  return rows.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function putMessage(message: Message): Promise<void> {
  const db = await getDb();
  await db.put("messages", message);
}

export async function deleteMessage(messageId: string): Promise<void> {
  const db = await getDb();
  await db.delete("messages", messageId);
}

export async function getSettings(defaults: AppSettings): Promise<AppSettings> {
  const db = await getDb();
  const row = await db.get("settings", "app");
  if (!row) {
    return defaults;
  }

  return {
    ...defaults,
    ...row.value,
  };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const db = await getDb();
  await db.put("settings", {
    key: "app",
    value: settings,
  });
}

export function resetDbForTests() {
  dbPromise = null;
}

export async function closeDbForTests() {
  if (!dbPromise) {
    return;
  }

  const db = await dbPromise;
  db.close();
  dbPromise = null;
}
