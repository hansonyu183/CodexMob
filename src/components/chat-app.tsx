"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";

import { MarkdownMessage } from "@/components/markdown-message";
import { consumeSse } from "@/lib/chat/streaming";
import { getSettings, saveSettings } from "@/lib/db/repository";
import {
  loadHistoryConversations,
  loadHistoryMessages,
  runHistorySync,
} from "@/lib/history/client";
import { cn } from "@/lib/utils";
import type {
  ApiErrorShape,
  AppSettings,
  HistoryConversation,
  HistoryMessage,
  ModelsResponse,
  RuntimeAuthStatus,
} from "@/lib/types";

const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  defaultModel: "gpt-5.4",
  accessCode: "",
};

function nowIso() {
  return new Date().toISOString();
}

async function fetchJson<T>(url: string, accessCode: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "x-app-access-code": accessCode,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    let err: ApiErrorShape = {
      code: "UPSTREAM_ERROR",
      message: `Request failed (${response.status})`,
    };
    try {
      const body = (await response.json()) as Partial<ApiErrorShape>;
      if (typeof body.code === "string" && typeof body.message === "string") {
        err = { code: body.code as ApiErrorShape["code"], message: body.message };
      }
    } catch {
      // ignore parse errors
    }
    throw err;
  }

  return (await response.json()) as T;
}

function toHistoryMessage(
  conversationId: string,
  role: "user" | "assistant" | "system",
  content: string,
): HistoryMessage {
  return {
    id: nanoid(),
    conversationId,
    role,
    content,
    createdAt: nowIso(),
    source: "codex_active",
  };
}

function projectKeyFromCwd(cwd: string | null): string {
  if (!cwd?.trim()) {
    return "unknown";
  }
  return cwd;
}

function projectNameFromCwd(cwd: string | null): string {
  if (!cwd?.trim()) {
    return "Unknown";
  }

  const normalized = cwd.replaceAll("\\", "/").replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

function pathSuffixFromCwd(cwd: string | null): string {
  if (!cwd?.trim()) {
    return "";
  }
  const normalized = cwd.replaceAll("\\", "/").replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  const parent = parts.slice(0, -1);
  return parent.slice(-2).join("/");
}

function compactText(text: string, max = 56): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max - 1)}…`;
}

function relativeTimeText(iso: string): string {
  const now = Date.now();
  const target = Date.parse(iso);
  if (!Number.isFinite(target)) {
    return "";
  }

  const diffMs = Math.max(0, now - target);
  const minutes = Math.floor(diffMs / (60 * 1000));
  if (minutes < 1) {
    return "刚刚";
  }
  if (minutes < 60) {
    return `${minutes} 分钟`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days} 天`;
  }
  const months = Math.floor(days / 30);
  return `${months} 个月`;
}

export function ChatApp() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsDraft, setSettingsDraft] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [conversations, setConversations] = useState<HistoryConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string>("");
  const [messages, setMessages] = useState<HistoryMessage[]>([]);
  const [models, setModels] = useState<string[]>([DEFAULT_SETTINGS.defaultModel]);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeAuthStatus>({
    ready: false,
    loginMethod: "none",
    message: "尚未检查",
  });
  const [draft, setDraft] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [notice, setNotice] = useState<string>("");
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});
  const [previewByConversationId, setPreviewByConversationId] = useState<Record<string, string>>(
    {},
  );
  const [selectedProjectCwd, setSelectedProjectCwd] = useState<string | null>(null);
  const [newConversationCwd, setNewConversationCwd] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const previewLoadingRef = useRef<Set<string>>(new Set());
  const messageViewportRef = useRef<HTMLDivElement | null>(null);

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === activeConversationId),
    [activeConversationId, conversations],
  );

  const groupedConversations = useMemo(() => {
    const groups = new Map<
      string,
      {
        baseName: string;
        cwd: string | null;
        items: HistoryConversation[];
      }
    >();

    for (const conversation of conversations) {
      const key = projectKeyFromCwd(conversation.cwd);
      const group = groups.get(key) ?? {
        baseName: projectNameFromCwd(conversation.cwd),
        cwd: conversation.cwd,
        items: [],
      };
      group.items.push(conversation);
      groups.set(key, group);
    }

    const duplicateBaseNameCount = new Map<string, number>();
    for (const group of groups.values()) {
      duplicateBaseNameCount.set(
        group.baseName,
        (duplicateBaseNameCount.get(group.baseName) ?? 0) + 1,
      );
    }

    return Array.from(groups.entries())
      .map(([key, group]) => ({
        key,
        cwd: group.cwd,
        name:
          (duplicateBaseNameCount.get(group.baseName) ?? 0) > 1
            ? `${group.baseName} · ${pathSuffixFromCwd(group.cwd) || "root"}`
            : group.baseName,
        items: group.items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      }))
      .sort((a, b) => {
        const left = a.items[0]?.updatedAt ?? "";
        const right = b.items[0]?.updatedAt ?? "";
        return right.localeCompare(left);
      });
  }, [conversations]);

  const applyTheme = useCallback((theme: "dark" | "light") => {
    document.documentElement.dataset.theme = theme;
  }, []);

  const scrollToLatest = useCallback((behavior: ScrollBehavior = "auto") => {
    const node = messageViewportRef.current;
    if (!node) {
      return;
    }
    node.scrollTo({
      top: node.scrollHeight,
      behavior,
    });
  }, []);

  const loadRemoteMeta = useCallback(
    async (accessCode: string) => {
      if (!accessCode.trim()) {
        setRuntimeStatus({
          ready: false,
          loginMethod: "none",
          message: "请先在设置中填写访问码",
        });
        return;
      }

      try {
        const [auth, modelPayload] = await Promise.all([
          fetchJson<RuntimeAuthStatus>("/api/auth/status", accessCode),
          fetchJson<ModelsResponse>("/api/models", accessCode),
        ]);
        setRuntimeStatus(auth);
        setModels(modelPayload.models);
      } catch (error) {
        const apiError =
          (error as ApiErrorShape) ??
          ({
            code: "UPSTREAM_ERROR",
            message: "服务连接失败",
          } as ApiErrorShape);
        setRuntimeStatus({
          ready: false,
          loginMethod: "none",
          message: apiError.message,
        });
        setNotice(apiError.message);
      }
    },
    [],
  );

  const refreshConversations = useCallback(
    async (accessCode: string) => {
      const rows = await loadHistoryConversations(accessCode);
      setConversations(rows);
      if (!activeConversationId && rows.length > 0) {
        setActiveConversationId(rows[0].id);
        setSelectedProjectCwd(rows[0].cwd ?? null);
      }
      return rows;
    },
    [activeConversationId],
  );

  const refreshMessages = useCallback(async (accessCode: string, conversationId: string) => {
    const rows = await loadHistoryMessages(accessCode, conversationId);
    setMessages(rows);
  }, []);

  const performStartupSync = useCallback(
    async (accessCode: string) => {
      if (!accessCode.trim()) {
        return;
      }
      await runHistorySync(accessCode, "startup");
    },
    [],
  );

  useEffect(() => {
    void (async () => {
      const localSettings = await getSettings(DEFAULT_SETTINGS);
      setSettings(localSettings);
      setSettingsDraft(localSettings);
      applyTheme(localSettings.theme);

      if (localSettings.accessCode.trim()) {
        await performStartupSync(localSettings.accessCode);
      }
      if (localSettings.accessCode.trim()) {
        await refreshConversations(localSettings.accessCode);
      }

      await loadRemoteMeta(localSettings.accessCode);
    })();
  }, [applyTheme, loadRemoteMeta, performStartupSync, refreshConversations]);

  useEffect(() => {
    if (!activeConversationId || !settings.accessCode.trim()) {
      return;
    }
    void refreshMessages(settings.accessCode, activeConversationId);
  }, [activeConversationId, refreshMessages, settings.accessCode]);

  useEffect(() => {
    if (activeConversation?.cwd) {
      setSelectedProjectCwd(activeConversation.cwd);
    }
  }, [activeConversation?.cwd]);

  useEffect(() => {
    if (!activeConversationId) {
      return;
    }
    const frame = window.requestAnimationFrame(() => scrollToLatest("auto"));
    return () => window.cancelAnimationFrame(frame);
  }, [activeConversationId, scrollToLatest]);

  useEffect(() => {
    if (messages.length === 0) {
      return;
    }
    const frame = window.requestAnimationFrame(() => scrollToLatest("auto"));
    return () => window.cancelAnimationFrame(frame);
  }, [messages.length, scrollToLatest]);

  useEffect(() => {
    if (!settings.accessCode.trim() || conversations.length === 0) {
      return;
    }

    const targets = conversations
      .filter(
        (conversation) =>
          !previewByConversationId[conversation.id] &&
          !previewLoadingRef.current.has(conversation.id),
      )
      .slice(0, 40);

    if (targets.length === 0) {
      return;
    }

    let cancelled = false;
    const targetIds = targets.map((item) => item.id);
    for (const conversation of targets) {
      previewLoadingRef.current.add(conversation.id);
    }

    void (async () => {
      try {
        const loaded = await Promise.all(
          targets.map(async (conversation) => {
            try {
              const rows = await loadHistoryMessages(settings.accessCode, conversation.id);
              const lastUser = [...rows].reverse().find((item) => item.role === "user");
              return [conversation.id, compactText(lastUser?.content ?? conversation.title)] as const;
            } catch {
              return [conversation.id, compactText(conversation.title)] as const;
            }
          }),
        );

        if (cancelled) {
          return;
        }

        setPreviewByConversationId((prev) => {
          const next = { ...prev };
          for (const [id, summary] of loaded) {
            next[id] = summary;
          }
          return next;
        });
      } finally {
        for (const id of targetIds) {
          previewLoadingRef.current.delete(id);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [conversations, previewByConversationId, settings.accessCode]);

  const handleCreateConversation = useCallback(async () => {
    if (!settings.accessCode.trim()) {
      setNotice("请先设置访问码");
      return;
    }
    const cwd = selectedProjectCwd?.trim();
    if (!cwd) {
      setNotice("请先选择项目后再新建会话");
      return;
    }
    setActiveConversationId("");
    setNewConversationCwd(cwd);
    setMessages([]);
    setNotice("请输入首条消息以创建会话");
    setDrawerOpen(false);
  }, [selectedProjectCwd, settings.accessCode]);

  const streamAssistant = useCallback(
    async (input: {
      conversationId?: string;
      cwd: string;
      model: string;
      prompt: string;
      assistantDraftId: string;
    }) => {
      if (!settings.accessCode.trim()) {
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);
      setNotice("");

      let assistantText = "";
      let hasError = false;

      try {
        const response = await fetch("/api/chat/stream", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-app-access-code": settings.accessCode,
          },
          body: JSON.stringify({
            conversationId: input.conversationId,
            cwd: input.cwd,
            model: input.model,
            input: input.prompt,
          }),
          signal: controller.signal,
        });

        let resolvedConversationId = input.conversationId ?? "";
        await consumeSse(response, {
          onToken(token) {
            assistantText += token;
            setMessages((prev) =>
              prev.map((item) =>
                item.id === input.assistantDraftId ? { ...item, content: assistantText } : item,
              ),
            );
          },
          onDone(donePayload) {
            if (typeof donePayload.conversationId === "string" && donePayload.conversationId.trim()) {
              resolvedConversationId = donePayload.conversationId.trim();
            }
          },
          onError(error) {
            hasError = true;
            setNotice(error.message);
          },
        });

        if (!hasError && resolvedConversationId) {
          setActiveConversationId(resolvedConversationId);
          setNewConversationCwd(null);
          await refreshConversations(settings.accessCode);
          await refreshMessages(settings.accessCode, resolvedConversationId);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "流式请求失败";
        setNotice(message);
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [refreshConversations, refreshMessages, settings.accessCode],
  );

  const handleSend = useCallback(async () => {
    if (!settings.accessCode.trim() || isStreaming) {
      return;
    }
    const content = draft.trim();
    if (!content) {
      return;
    }

    const conversationId = activeConversation?.id;
    const cwd = activeConversation?.cwd?.trim() || newConversationCwd?.trim() || selectedProjectCwd?.trim() || "";
    if (!cwd) {
      setNotice("请先选择项目后再发送");
      return;
    }

    setDraft("");
    const draftConversationId = conversationId ?? `draft-${nanoid()}`;
    const userDraft = toHistoryMessage(draftConversationId, "user", content);
    const assistantDraft = toHistoryMessage(draftConversationId, "assistant", "");
    setMessages((prev) => [...prev, userDraft, assistantDraft]);

    await streamAssistant({
      conversationId,
      cwd,
      model: activeConversation?.model ?? settings.defaultModel,
      prompt: content,
      assistantDraftId: assistantDraft.id,
    });
  }, [
    activeConversation,
    draft,
    isStreaming,
    newConversationCwd,
    selectedProjectCwd,
    settings.accessCode,
    settings.defaultModel,
    streamAssistant,
  ]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  const handleManualSync = useCallback(async () => {
    if (!settingsDraft.accessCode.trim()) {
      setNotice("请先填写访问码");
      return;
    }
    const result = await runHistorySync(settingsDraft.accessCode, "manual");
    await refreshConversations(settingsDraft.accessCode);
    if (activeConversationId) {
      await refreshMessages(settingsDraft.accessCode, activeConversationId);
    }
    setNotice(`同步完成：${result.syncedSessions} 会话 / ${result.syncedMessages} 消息`);
  }, [activeConversationId, refreshConversations, refreshMessages, settingsDraft.accessCode]);

  const handleSaveSettings = useCallback(async () => {
    setSettings(settingsDraft);
    applyTheme(settingsDraft.theme);
    await saveSettings(settingsDraft);
    await loadRemoteMeta(settingsDraft.accessCode);
    await refreshConversations(settingsDraft.accessCode);
    if (activeConversationId) {
      await refreshMessages(settingsDraft.accessCode, activeConversationId);
    }
    setSettingsOpen(false);
  }, [
    activeConversationId,
    applyTheme,
    loadRemoteMeta,
    refreshConversations,
    refreshMessages,
    settingsDraft,
  ]);

  return (
    <div className="relative flex h-[100dvh] flex-col bg-app">
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-app px-3 py-2 backdrop-blur">
        <button
          type="button"
          onClick={() => setDrawerOpen((prev) => !prev)}
          className="rounded-lg border border-app px-3 py-1.5 text-sm text-app hover:bg-app-hover"
        >
          会话
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className={cn(
              "inline-block h-2 w-2 rounded-full",
              runtimeStatus.ready ? "bg-emerald-400" : "bg-amber-400",
            )}
          />
          <select
            className="w-full rounded-lg border border-app bg-panel px-2 py-1.5 text-sm text-app"
            value={activeConversation?.model ?? settings.defaultModel}
            onChange={() => setNotice("会话模型以历史源为准，当前不支持直接改模型。")}
          >
            {models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="rounded-lg border border-app px-3 py-1.5 text-sm text-app hover:bg-app-hover"
        >
          设置
        </button>
      </header>

      <main className="relative flex min-h-0 min-w-0 flex-1">
        <aside
          className={cn(
            "absolute inset-y-0 left-0 z-30 w-80 border-r border-app bg-panel p-2 transition-transform",
            drawerOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="mb-2 flex items-center justify-between px-2">
            <h2 className="text-sm font-semibold text-app">线程</h2>
            <button
              type="button"
              onClick={() => void handleCreateConversation()}
              className="rounded-md border border-app px-2 py-1 text-xs text-app hover:bg-app-hover"
            >
              新建
            </button>
          </div>

          <div className="space-y-2">
            {groupedConversations.map((group) => {
              const collapsed = collapsedProjects[group.key] === true;
              return (
                <section key={group.key} className="rounded-lg border border-app bg-app">
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium text-app-muted",
                      group.cwd && group.cwd === selectedProjectCwd ? "bg-app-hover" : "",
                    )}
                    onClick={() =>
                      {
                        if (group.cwd) {
                          setSelectedProjectCwd(group.cwd);
                        }
                        setCollapsedProjects((prev) => ({
                          ...prev,
                          [group.key]: !collapsed,
                        }));
                      }
                    }
                  >
                    <span className="truncate">📁 {group.name}</span>
                    <span className="text-xs">{collapsed ? "+" : "−"}</span>
                  </button>

                  {!collapsed ? (
                    <div className="space-y-0.5 pb-1">
                      {group.items.map((conversation) => (
                        <button
                          type="button"
                          key={conversation.id}
                          className={cn(
                            "w-full border-l-2 px-3 py-2 text-left transition-colors",
                              conversation.id === activeConversationId
                                ? "border-l-cyan-400 bg-app-hover"
                                : "border-l-transparent hover:bg-app-hover",
                          )}
                          onClick={() => {
                            setActiveConversationId(conversation.id);
                            setSelectedProjectCwd(conversation.cwd ?? null);
                            setNewConversationCwd(null);
                            setDrawerOpen(false);
                          }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm text-app">{conversation.title}</div>
                              <div className="mt-0.5 truncate text-xs text-app-muted">
                                {previewByConversationId[conversation.id] ?? "…"}
                              </div>
                            </div>
                            <div className="shrink-0 text-xs text-app-muted">
                              {relativeTimeText(conversation.updatedAt)}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        </aside>

        {drawerOpen ? (
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 z-20 bg-black/30"
            aria-label="关闭会话抽屉"
          />
        ) : null}

        <section className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col">
          <div ref={messageViewportRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
            <div className="mx-auto flex w-full max-w-none flex-col gap-4 md:max-w-3xl">
              {messages.length === 0 ? (
                <div className="rounded-xl border border-app bg-panel p-4 text-sm text-app-muted">
                  输入问题开始对话。当前模式：{runtimeStatus.message}
                </div>
              ) : null}
              {messages.map((message) => (
                <article
                  key={message.id}
                  className={cn(
                    "min-w-0 rounded-2xl border px-3 py-3 text-sm sm:px-4",
                    message.role === "user"
                      ? "ml-auto w-fit max-w-full border-sky-400/30 bg-sky-500/10 text-sky-50 sm:max-w-[92%] md:max-w-[85%]"
                      : "mr-auto w-full max-w-full border-app bg-panel text-app sm:max-w-[92%] md:max-w-[85%]",
                  )}
                >
                  <div className="mb-1 text-xs uppercase tracking-wide text-app-muted">
                    {message.role === "user" ? "You" : "Codex"}
                  </div>
                  {message.role === "assistant" ? (
                    <MarkdownMessage content={message.content} />
                  ) : (
                    <p className="whitespace-pre-wrap break-words leading-7 [overflow-wrap:anywhere]">
                      {message.content}
                    </p>
                  )}
                </article>
              ))}
            </div>
          </div>

          <div className="border-t border-app bg-panel px-3 py-3">
            <div className="mx-auto flex w-full max-w-none flex-col gap-2 md:max-w-3xl">
              {notice ? (
                <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
                  {notice}
                </div>
              ) : null}
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={4}
                placeholder="输入你的问题..."
                className="w-full resize-none rounded-xl border border-app bg-app px-3 py-2 text-sm text-app outline-none focus:border-sky-400/60"
              />
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-app-muted">
                  {runtimeStatus.ready ? "Codex 已连接" : runtimeStatus.message}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled
                    className="rounded-lg border border-app px-3 py-1.5 text-xs text-app opacity-40"
                  >
                    重新生成
                  </button>
                  {isStreaming ? (
                    <button
                      type="button"
                      onClick={handleStop}
                      className="rounded-lg border border-red-400/40 px-3 py-1.5 text-xs text-red-300"
                    >
                      停止
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleSend()}
                      className="rounded-lg border border-sky-400/50 bg-sky-500/20 px-3 py-1.5 text-xs text-sky-100"
                    >
                      发送
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {settingsOpen ? (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 sm:items-center sm:justify-center">
          <div className="w-full rounded-t-2xl border border-app bg-panel p-4 sm:w-[440px] sm:rounded-2xl">
            <h3 className="mb-3 text-base font-semibold text-app">设置</h3>
            <div className="space-y-3 text-sm">
              <label className="block">
                <span className="mb-1 block text-app-muted">访问码</span>
                <input
                  type="password"
                  value={settingsDraft.accessCode}
                  onChange={(event) =>
                    setSettingsDraft((prev) => ({ ...prev, accessCode: event.target.value }))
                  }
                  className="w-full rounded-lg border border-app bg-app px-3 py-2 text-app"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-app-muted">默认模型</span>
                <select
                  value={settingsDraft.defaultModel}
                  onChange={(event) =>
                    setSettingsDraft((prev) => ({ ...prev, defaultModel: event.target.value }))
                  }
                  className="w-full rounded-lg border border-app bg-app px-3 py-2 text-app"
                >
                  {models.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-app-muted">主题</span>
                <select
                  value={settingsDraft.theme}
                  onChange={(event) =>
                    setSettingsDraft((prev) => ({
                      ...prev,
                      theme: event.target.value as AppSettings["theme"],
                    }))
                  }
                  className="w-full rounded-lg border border-app bg-app px-3 py-2 text-app"
                >
                  <option value="dark">深色</option>
                  <option value="light">浅色</option>
                </select>
              </label>

              <div className="rounded-lg border border-app bg-app px-3 py-2 text-xs text-app-muted">
                当前认证状态：{runtimeStatus.ready ? "已就绪" : "未就绪"}（
                {runtimeStatus.loginMethod}）
              </div>
            </div>

            <div className="mt-4 flex justify-between gap-2">
              <button
                type="button"
                className="rounded-lg border border-emerald-500/50 bg-emerald-500/15 px-3 py-1.5 text-sm text-emerald-200"
                onClick={() => void handleManualSync()}
              >
                立即同步
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-app px-3 py-1.5 text-sm text-app"
                  onClick={() => setSettingsOpen(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-sky-400/60 bg-sky-500/20 px-3 py-1.5 text-sm text-sky-100"
                  onClick={() => void handleSaveSettings()}
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
