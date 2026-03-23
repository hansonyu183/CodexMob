"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";

import { getMessagePlainText, MarkdownMessage } from "@/components/markdown-message";
import { consumeSse } from "@/lib/chat/streaming";
import { getSettings, saveSettings } from "@/lib/db/repository";
import {
  loadHistoryConversations,
  loadHistoryMessages,
  runHistorySync,
} from "@/lib/history/client";
import { cn } from "@/lib/utils";
import type {
  AttachmentRef,
  ApiErrorShape,
  AppSettings,
  ChatMode,
  HistoryConversation,
  HistoryMessage,
  ModelsResponse,
  RuntimeAuthStatus,
  StreamStatusEvent,
  StreamToolEvent,
  UploadItem,
} from "@/lib/types";

const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  defaultModel: "gpt-5.4",
  accessCode: "",
};

const CHAT_MODE_CACHE_KEY = "codexmob.chatModeByScope.v1";
const MODEL_CACHE_KEY = "codexmob.modelByScope.v1";
const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".json",
  ".yaml",
  ".yml",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".css",
  ".html",
  ".sh",
  ".ps1",
  ".sql",
  ".log",
]);

type UploadQueueItem =
  | ({ localId: string; status: "uploading" } & Pick<UploadItem, "name" | "size">)
  | ({ localId: string; status: "error"; error: string } & Pick<UploadItem, "name" | "size">)
  | ({ localId: string; status: "ready" } & UploadItem);

interface ProcessEventRow {
  id: string;
  kind: "status" | "tool";
  text: string;
  createdAt: string;
}

interface AttachmentPreviewState {
  item: AttachmentRef;
  loading: boolean;
  error: string;
  textContent: string;
  objectUrl: string;
}

function nowIso() {
  return new Date().toISOString();
}

function formatFileSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function extensionOf(name: string): string {
  const cleaned = name.trim().toLowerCase();
  const idx = cleaned.lastIndexOf(".");
  return idx >= 0 ? cleaned.slice(idx) : "";
}

function normalizePathKey(value: string): string {
  return value.trim().replaceAll("/", "\\").replace(/\\+/g, "\\").toLowerCase();
}

function validateFileForUpload(file: File): string | null {
  if (file.size <= 0) {
    return "文件为空。";
  }
  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return "文件超过 10MB 限制。";
  }
  const ext = extensionOf(file.name);
  const mime = file.type.toLowerCase();
  const isImage = IMAGE_EXTENSIONS.has(ext);
  const isText = TEXT_EXTENSIONS.has(ext) || mime.startsWith("text/");
  if (!isImage && !isText) {
    return "仅支持图片和文本文件。";
  }
  return null;
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
  const [chatModeByScope, setChatModeByScope] = useState<Record<string, ChatMode>>({});
  const [chatMode, setChatMode] = useState<ChatMode>("default");
  const [modelByScope, setModelByScope] = useState<Record<string, string>>({});
  const [selectedModel, setSelectedModel] = useState(DEFAULT_SETTINGS.defaultModel);
  const [customModelInput, setCustomModelInput] = useState("");
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const [conversationAttachments, setConversationAttachments] = useState<AttachmentRef[]>([]);
  const [previewState, setPreviewState] = useState<AttachmentPreviewState | null>(null);
  const [streamEvents, setStreamEvents] = useState<ProcessEventRow[]>([]);
  const [streamPanelOpen, setStreamPanelOpen] = useState(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewLoadingRef = useRef<Set<string>>(new Set());
  const messageViewportRef = useRef<HTMLDivElement | null>(null);
  const previewObjectUrlRef = useRef<string>("");

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === activeConversationId),
    [activeConversationId, conversations],
  );
  const currentDraftCwd = useMemo(
    () => newConversationCwd?.trim() || selectedProjectCwd?.trim() || "",
    [newConversationCwd, selectedProjectCwd],
  );
  const modeScopeKey = useMemo(() => {
    if (activeConversationId) {
      return `conv:${activeConversationId}`;
    }
    if (currentDraftCwd) {
      return `cwd:${currentDraftCwd.toLowerCase()}`;
    }
    return "global";
  }, [activeConversationId, currentDraftCwd]);
  const modelScopeKey = modeScopeKey;

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

  const handleMessageViewportScroll = useCallback(() => {
    const node = messageViewportRef.current;
    if (!node) {
      return;
    }
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    setShowJumpToLatest(distance > 80);
  }, []);

  const copyMessage = useCallback(async (messageId: string, content: string) => {
    const text = getMessagePlainText(content);
    if (!text) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageId(messageId);
      window.setTimeout(() => {
        setCopiedMessageId((prev) => (prev === messageId ? "" : prev));
      }, 1200);
    } catch {
      setNotice("复制失败，请重试");
    }
  }, []);

  const loadConversationAttachments = useCallback(
    async (accessCode: string, conversationId: string) => {
      if (!accessCode.trim() || !conversationId.trim()) {
        setConversationAttachments([]);
        return;
      }
      try {
        const response = await fetch(`/api/files/conversations/${encodeURIComponent(conversationId)}`, {
          headers: {
            "x-app-access-code": accessCode,
          },
          cache: "no-store",
        });
        if (!response.ok) {
          setConversationAttachments([]);
          return;
        }
        const payload = (await response.json()) as { items?: AttachmentRef[] };
        setConversationAttachments(Array.isArray(payload.items) ? payload.items : []);
      } catch {
        setConversationAttachments([]);
      }
    },
    [],
  );

  const resolveAttachmentByPath = useCallback(
    (targetPath: string): AttachmentRef | null => {
      const key = normalizePathKey(targetPath);
      if (!key) {
        return null;
      }

      const fromConversation = conversationAttachments.find(
        (item) => normalizePathKey(item.path) === key,
      );
      if (fromConversation) {
        return fromConversation;
      }

      const fromQueue = uploadQueue.find(
        (item): item is Extract<UploadQueueItem, { status: "ready" }> =>
          item.status === "ready" && normalizePathKey(item.path) === key,
      );
      if (!fromQueue) {
        return null;
      }
      return {
        conversationId: activeConversationId || "",
        id: fromQueue.id,
        name: fromQueue.name,
        path: fromQueue.path,
        kind: fromQueue.kind,
        size: fromQueue.size,
      };
    },
    [activeConversationId, conversationAttachments, uploadQueue],
  );

  const resolveAttachmentHref = useCallback(
    (targetPath: string): string | null => {
      const item = resolveAttachmentByPath(targetPath);
      return item ? `/api/files/preview/${encodeURIComponent(item.id)}` : null;
    },
    [resolveAttachmentByPath],
  );

  const closePreview = useCallback(() => {
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current);
      previewObjectUrlRef.current = "";
    }
    setPreviewState(null);
  }, []);

  const downloadAttachment = useCallback(async () => {
    if (!previewState || !settings.accessCode.trim()) {
      return;
    }
    try {
      const response = await fetch(`/api/files/download/${encodeURIComponent(previewState.item.id)}`, {
        headers: {
          "x-app-access-code": settings.accessCode,
        },
      });
      if (!response.ok) {
        setNotice("下载失败");
        return;
      }
      const blob = await response.blob();
      const link = document.createElement("a");
      const href = URL.createObjectURL(blob);
      link.href = href;
      link.download = previewState.item.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
    } catch {
      setNotice("下载失败，请重试");
    }
  }, [previewState, settings.accessCode]);

  const openAttachmentPreview = useCallback(
    async (targetPath: string) => {
      const item = resolveAttachmentByPath(targetPath);
      if (!item) {
        setNotice("该路径不是当前会话附件，无法预览。");
        return;
      }
      if (!settings.accessCode.trim()) {
        setNotice("请先在设置中填写访问码");
        return;
      }

      closePreview();
      setPreviewState({
        item,
        loading: true,
        error: "",
        textContent: "",
        objectUrl: "",
      });

      try {
        const response = await fetch(`/api/files/preview/${encodeURIComponent(item.id)}`, {
          headers: {
            "x-app-access-code": settings.accessCode,
          },
        });
        if (!response.ok) {
          let message = `预览失败 (${response.status})`;
          try {
            const body = (await response.json()) as Partial<ApiErrorShape>;
            if (typeof body.message === "string" && body.message.trim()) {
              message = body.message;
            }
          } catch {
            // ignore parse error
          }
          setPreviewState((prev) => (prev ? { ...prev, loading: false, error: message } : prev));
          return;
        }

        if (item.kind === "text") {
          const text = await response.text();
          setPreviewState((prev) =>
            prev
              ? {
                  ...prev,
                  loading: false,
                  textContent: text,
                }
              : prev,
          );
          return;
        }

        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        previewObjectUrlRef.current = objectUrl;
        setPreviewState((prev) =>
          prev
            ? {
                ...prev,
                loading: false,
                objectUrl,
              }
            : prev,
        );
      } catch {
        setPreviewState((prev) =>
          prev
            ? {
                ...prev,
                loading: false,
                error: "预览失败，请稍后再试。",
              }
            : prev,
        );
      }
    },
    [closePreview, resolveAttachmentByPath, settings.accessCode],
  );

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
        setSettings((prev) => ({
          ...prev,
          defaultModel: modelPayload.defaultModel,
        }));
        setSettingsDraft((prev) => ({
          ...prev,
          defaultModel: modelPayload.defaultModel,
        }));
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
    if (!activeConversationId || !settings.accessCode.trim()) {
      setConversationAttachments([]);
      return;
    }
    void loadConversationAttachments(settings.accessCode, activeConversationId);
  }, [activeConversationId, loadConversationAttachments, settings.accessCode]);

  useEffect(() => {
    return () => {
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (activeConversation?.cwd) {
      setSelectedProjectCwd(activeConversation.cwd);
    }
  }, [activeConversation?.cwd]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CHAT_MODE_CACHE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const next: Record<string, ChatMode> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (value === "default" || value === "plan") {
          next[key] = value;
        }
      }
      setChatModeByScope(next);
    } catch {
      // ignore malformed cache
    }
  }, []);

  useEffect(() => {
    setChatMode(chatModeByScope[modeScopeKey] ?? "default");
  }, [chatModeByScope, modeScopeKey]);

  useEffect(() => {
    window.localStorage.setItem(CHAT_MODE_CACHE_KEY, JSON.stringify(chatModeByScope));
  }, [chatModeByScope]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(MODEL_CACHE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const next: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string" && value.trim()) {
          next[key] = value.trim();
        }
      }
      setModelByScope(next);
    } catch {
      // ignore malformed cache
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(MODEL_CACHE_KEY, JSON.stringify(modelByScope));
  }, [modelByScope]);

  useEffect(() => {
    const fallback =
      modelByScope[modelScopeKey] ||
      activeConversation?.model ||
      settings.defaultModel ||
      models[0] ||
      DEFAULT_SETTINGS.defaultModel;
    setSelectedModel(fallback);
  }, [activeConversation?.model, modelByScope, modelScopeKey, models, settings.defaultModel]);

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
    const frame = window.requestAnimationFrame(() => handleMessageViewportScroll());
    return () => window.cancelAnimationFrame(frame);
  }, [messages.length, isStreaming, handleMessageViewportScroll]);

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

  const appendProcessEvent = useCallback((row: Omit<ProcessEventRow, "id" | "createdAt">) => {
    setStreamEvents((prev) => [
      ...prev,
      {
        id: nanoid(),
        kind: row.kind,
        text: row.text,
        createdAt: nowIso(),
      },
    ]);
  }, []);

  const updateChatModeForScope = useCallback(
    (mode: ChatMode) => {
      setChatMode(mode);
      setChatModeByScope((prev) => ({
        ...prev,
        [modeScopeKey]: mode,
      }));
    },
    [modeScopeKey],
  );

  const updateModelForScope = useCallback(
    (model: string) => {
      const next = model.trim();
      if (!next) {
        return;
      }
      setSelectedModel(next);
      setModelByScope((prev) => ({
        ...prev,
        [modelScopeKey]: next,
      }));
    },
    [modelScopeKey],
  );

  const modelOptions = useMemo(() => {
    const list = Array.from(new Set(models.filter((item) => item.trim())));
    if (selectedModel.trim() && !list.includes(selectedModel.trim())) {
      list.push(selectedModel.trim());
    }
    return list;
  }, [models, selectedModel]);

  const removeUploadItem = useCallback((localId: string) => {
    setUploadQueue((prev) => prev.filter((item) => item.localId !== localId));
  }, []);

  const uploadSingleFile = useCallback(
    async (localId: string, file: File) => {
      if (!settings.accessCode.trim()) {
        setUploadQueue((prev) =>
          prev.map((item) =>
            item.localId === localId
              ? { ...item, status: "error", error: "请先设置访问码" }
              : item,
          ),
        );
        return;
      }

      const form = new FormData();
      form.append("scope", activeConversationId || currentDraftCwd || "temp");
      form.append("files", file);

      try {
        const response = await fetch("/api/uploads", {
          method: "POST",
          headers: {
            "x-app-access-code": settings.accessCode,
          },
          body: form,
        });

        if (!response.ok) {
          let message = `上传失败 (${response.status})`;
          try {
            const body = (await response.json()) as Partial<ApiErrorShape>;
            if (typeof body.message === "string" && body.message.trim()) {
              message = body.message;
            }
          } catch {
            // ignore parsing failure
          }
          throw new Error(message);
        }

        const body = (await response.json()) as { items?: UploadItem[] };
        const first = Array.isArray(body.items) ? body.items[0] : undefined;
        if (!first) {
          throw new Error("上传响应无效。");
        }

        setUploadQueue((prev) =>
          prev.map((item) =>
            item.localId === localId
              ? {
                  localId,
                  status: "ready",
                  id: first.id,
                  name: first.name,
                  path: first.path,
                  kind: first.kind,
                  size: first.size,
                }
              : item,
          ),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "上传失败";
        setUploadQueue((prev) =>
          prev.map((item) =>
            item.localId === localId
              ? { ...item, status: "error", error: message }
              : item,
          ),
        );
      }
    },
    [activeConversationId, currentDraftCwd, settings.accessCode],
  );

  const handlePickFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) {
        return;
      }

      const files = Array.from(fileList);
      const tasks: Array<Promise<void>> = [];
      let blockedMessage = "";
      for (const file of files) {
        const invalid = validateFileForUpload(file);
        if (invalid) {
          blockedMessage = `${file.name}: ${invalid}`;
          continue;
        }
        const localId = nanoid();
        setUploadQueue((prev) => [
          ...prev,
          {
            localId,
            status: "uploading",
            name: file.name,
            size: file.size,
          },
        ]);
        tasks.push(uploadSingleFile(localId, file));
      }

      if (blockedMessage) {
        setNotice(blockedMessage);
      }
      if (tasks.length > 0) {
        await Promise.all(tasks);
      }
    },
    [uploadSingleFile],
  );

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
    setStreamEvents([]);
    setUploadQueue([]);
    setNotice("请输入首条消息以创建会话");
    setDrawerOpen(false);
  }, [selectedProjectCwd, settings.accessCode]);

  const streamAssistant = useCallback(
    async (input: {
      conversationId?: string;
      cwd: string;
      model: string;
      prompt: string;
      mode: ChatMode;
      attachments: UploadItem[];
      assistantDraftId: string;
    }) => {
      if (!settings.accessCode.trim()) {
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);
      setNotice("");
      setStreamEvents([]);
      setStreamPanelOpen(true);
      appendProcessEvent({
        kind: "status",
        text: input.conversationId ? "恢复会话中..." : "创建会话中...",
      });

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
            mode: input.mode,
            attachments: input.attachments,
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
            appendProcessEvent({
              kind: "status",
              text: "完成",
            });
            setShowJumpToLatest(false);
          },
          onError(error) {
            hasError = true;
            setNotice(error.message);
            appendProcessEvent({
              kind: "status",
              text: `错误：${error.message}`,
            });
          },
          onStatus(event: StreamStatusEvent) {
            const text = event.detail ? `${event.phase} · ${event.detail}` : event.phase;
            appendProcessEvent({
              kind: "status",
              text,
            });
          },
          onTool(event: StreamToolEvent) {
            appendProcessEvent({
              kind: "tool",
              text: `${event.name} · ${event.state}${event.summary ? ` · ${event.summary}` : ""}`,
            });
          },
        });

        if (!hasError && resolvedConversationId) {
          if (!input.conversationId) {
            setChatModeByScope((prev) => ({
              ...prev,
              [`conv:${resolvedConversationId}`]: input.mode,
            }));
            setModelByScope((prev) => ({
              ...prev,
              [`conv:${resolvedConversationId}`]: input.model,
            }));
          }
          setActiveConversationId(resolvedConversationId);
          setNewConversationCwd(null);
          setUploadQueue([]);
          await refreshConversations(settings.accessCode);
          await refreshMessages(settings.accessCode, resolvedConversationId);
          await loadConversationAttachments(settings.accessCode, resolvedConversationId);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "流式请求失败";
        setNotice(message);
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [
      appendProcessEvent,
      loadConversationAttachments,
      refreshConversations,
      refreshMessages,
      settings.accessCode,
    ],
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
    const uploadingCount = uploadQueue.filter((item) => item.status === "uploading").length;
    if (uploadingCount > 0) {
      setNotice("文件仍在上传中，请稍候再发送。");
      return;
    }
    const failed = uploadQueue.find((item) => item.status === "error");
    if (failed) {
      setNotice(`存在上传失败文件：${failed.name}`);
      return;
    }
    const readyAttachments = uploadQueue
      .filter((item) => item.status === "ready")
      .map((item) => ({
        id: item.id,
        name: item.name,
        path: item.path,
        kind: item.kind,
        size: item.size,
      }));

    setDraft("");
    const draftConversationId = conversationId ?? `draft-${nanoid()}`;
    const userDraft = toHistoryMessage(draftConversationId, "user", content);
    const assistantDraft = toHistoryMessage(draftConversationId, "assistant", "");
    setMessages((prev) => [...prev, userDraft, assistantDraft]);

    await streamAssistant({
      conversationId,
      cwd,
      model: selectedModel.trim() || activeConversation?.model || settings.defaultModel,
      prompt: content,
      mode: chatMode,
      attachments: readyAttachments,
      assistantDraftId: assistantDraft.id,
    });
  }, [
    activeConversation,
    chatMode,
    draft,
    isStreaming,
    newConversationCwd,
    selectedModel,
    selectedProjectCwd,
    settings.accessCode,
    settings.defaultModel,
    streamAssistant,
    uploadQueue,
  ]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    appendProcessEvent({
      kind: "status",
      text: "已手动停止",
    });
  }, [appendProcessEvent]);

  const handleManualSync = useCallback(async () => {
    if (!settingsDraft.accessCode.trim()) {
      setNotice("请先填写访问码");
      return;
    }
    const targetCwd = activeConversation?.cwd?.trim() || currentDraftCwd || undefined;
    const result = await runHistorySync(settingsDraft.accessCode, "manual", targetCwd);
    await refreshConversations(settingsDraft.accessCode);
    if (activeConversationId) {
      await refreshMessages(settingsDraft.accessCode, activeConversationId);
    }
    setNotice(`同步完成：${result.syncedSessions} 会话 / ${result.syncedMessages} 消息`);
  }, [
    activeConversation?.cwd,
    activeConversationId,
    currentDraftCwd,
    refreshConversations,
    refreshMessages,
    settingsDraft.accessCode,
  ]);

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
            className="min-w-0 flex-1 rounded-lg border border-app bg-panel px-2 py-1.5 text-sm text-app"
            value={selectedModel}
            onChange={(event) => {
              updateModelForScope(event.target.value);
              setCustomModelInput("");
            }}
          >
            {modelOptions.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
          <input
            className="w-36 rounded-lg border border-app bg-panel px-2 py-1.5 text-xs text-app"
            value={customModelInput}
            placeholder="自定义模型"
            onChange={(event) => setCustomModelInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                updateModelForScope(customModelInput);
                setCustomModelInput("");
              }
            }}
            onBlur={() => {
              if (!customModelInput.trim()) {
                return;
              }
              updateModelForScope(customModelInput);
              setCustomModelInput("");
            }}
          />
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
                            setUploadQueue([]);
                            setStreamEvents([]);
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
          <div
            ref={messageViewportRef}
            onScroll={handleMessageViewportScroll}
            className="min-h-0 flex-1 overflow-y-auto px-3 py-4"
          >
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
                    "group relative min-w-0 select-text rounded-2xl border px-3 py-3 pr-10 text-sm sm:px-4 sm:pr-11",
                    message.role === "user"
                      ? "ml-auto w-fit max-w-full border-sky-400/30 bg-sky-500/10 text-sky-50 sm:max-w-[92%] md:max-w-[85%]"
                      : "mr-auto w-full max-w-full border-app bg-panel text-app sm:max-w-[92%] md:max-w-[85%]",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => void copyMessage(message.id, message.content)}
                    className={cn(
                      "absolute right-2 top-2 z-20 rounded-md border border-app px-1.5 py-0.5 text-[11px] text-app-muted transition-opacity select-none touch-manipulation",
                      "opacity-10 hover:bg-app-hover hover:opacity-100 focus:opacity-100 group-hover:opacity-100",
                      copiedMessageId === message.id ? "opacity-100" : "",
                    )}
                    title="复制消息"
                    aria-label="复制消息"
                  >
                    {copiedMessageId === message.id ? "✓" : "⧉"}
                  </button>
                  <div className="mb-1 text-xs uppercase tracking-wide text-app-muted">
                    {message.role === "user" ? "You" : "Codex"}
                  </div>
                  {message.role === "assistant" ? (
                    <MarkdownMessage
                      content={message.content}
                      resolveAttachmentHref={resolveAttachmentHref}
                      onOpenAttachment={(_href, label) => {
                        void openAttachmentPreview(label);
                      }}
                    />
                  ) : (
                    <p className="message-text select-text whitespace-pre-wrap break-words leading-7 [overflow-wrap:anywhere]">
                      {message.content}
                    </p>
                  )}
                </article>
              ))}
            </div>
          </div>
          {showJumpToLatest ? (
            <button
              type="button"
              className="absolute bottom-28 right-5 z-20 h-10 w-10 rounded-full border border-app bg-panel text-app shadow-sm hover:bg-app-hover"
              onClick={() => scrollToLatest("smooth")}
              aria-label="直达最新消息"
              title="直达最新消息"
            >
              ↓
            </button>
          ) : null}

          <div className="border-t border-app bg-panel px-3 py-3">
            <div className="mx-auto flex w-full max-w-none flex-col gap-2 md:max-w-3xl">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                accept=".png,.jpg,.jpeg,.webp,.gif,.txt,.md,.json,.yaml,.yml,.js,.jsx,.ts,.tsx,.py,.go,.rs,.java,.c,.cpp,.h,.hpp,.css,.html,.sh,.ps1,.sql,.log,text/*"
                onChange={(event) => {
                  const files = event.target.files;
                  void handlePickFiles(files);
                  event.currentTarget.value = "";
                }}
              />
              {streamEvents.length > 0 ? (
                <div className="rounded-lg border border-app bg-app">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-xs text-app-muted"
                    onClick={() => setStreamPanelOpen((prev) => !prev)}
                  >
                    <span>过程流（{streamEvents.length}）</span>
                    <span>{streamPanelOpen ? "收起" : "展开"}</span>
                  </button>
                  {streamPanelOpen ? (
                    <div className="max-h-36 space-y-1 overflow-y-auto border-t border-app px-3 py-2 text-xs text-app-muted">
                      {streamEvents.map((row) => (
                        <div key={row.id} className="flex items-start gap-2">
                          <span className={cn("mt-0.5 h-1.5 w-1.5 rounded-full", row.kind === "tool" ? "bg-violet-300" : "bg-cyan-300")} />
                          <span className="break-words [overflow-wrap:anywhere]">{row.text}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {notice ? (
                <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
                  {notice}
                </div>
              ) : null}
              {uploadQueue.length > 0 ? (
                <div className="rounded-lg border border-app bg-app px-2 py-2">
                  <div className="mb-1 text-xs text-app-muted">附件队列</div>
                  <div className="space-y-1">
                    {uploadQueue.map((item) => (
                      <div
                        key={item.localId}
                        className="flex items-center justify-between gap-2 rounded-md border border-app px-2 py-1 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-app">{item.name}</div>
                          <div className="text-app-muted">
                            {formatFileSize(item.size)} · {item.status === "ready" ? item.kind : item.status}
                            {item.status === "error" ? ` · ${item.error}` : ""}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="rounded border border-app px-1.5 py-0.5 text-[11px] text-app-muted hover:bg-app-hover"
                          onClick={() => removeUploadItem(item.localId)}
                        >
                          删除
                        </button>
                      </div>
                    ))}
                  </div>
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
                  {runtimeStatus.ready ? `Codex 已连接 · ${chatMode === "plan" ? "计划模式" : "默认模式"}` : runtimeStatus.message}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-app text-lg leading-none text-app hover:bg-app-hover"
                    aria-label="添加图片和文件"
                    title="添加图片和文件"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => updateChatModeForScope(chatMode === "plan" ? "default" : "plan")}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-xs",
                      chatMode === "plan"
                        ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-100"
                        : "border-app text-app",
                    )}
                  >
                    计划模式
                  </button>
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
                      disabled={isStreaming}
                      onClick={() => void handleSend()}
                      className="rounded-lg border border-sky-400/50 bg-sky-500/20 px-3 py-1.5 text-xs text-sky-100 disabled:opacity-50"
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

      {previewState ? (
        <div className="fixed inset-0 z-40 flex items-end bg-black/45 sm:items-center sm:justify-center">
          <div className="flex h-[82dvh] w-full flex-col rounded-t-2xl border border-app bg-panel sm:h-[78vh] sm:w-[720px] sm:rounded-2xl">
            <div className="flex items-center justify-between border-b border-app px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm text-app">{previewState.item.name}</div>
                <div className="text-xs text-app-muted">{previewState.item.kind === "image" ? "图片预览" : "文本预览"}</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-app px-2 py-1 text-xs text-app hover:bg-app-hover"
                  onClick={() => void downloadAttachment()}
                >
                  下载
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-app px-2 py-1 text-xs text-app hover:bg-app-hover"
                  onClick={closePreview}
                >
                  关闭
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {previewState.loading ? (
                <div className="text-sm text-app-muted">加载中...</div>
              ) : previewState.error ? (
                <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
                  {previewState.error}
                </div>
              ) : previewState.item.kind === "image" ? (
                previewState.objectUrl ? (
                  <img src={previewState.objectUrl} alt={previewState.item.name} className="mx-auto max-h-full max-w-full rounded-lg border border-app" />
                ) : (
                  <div className="text-sm text-app-muted">图片不可用。</div>
                )
              ) : (
                <pre className="message-text whitespace-pre-wrap rounded-lg border border-app bg-app p-3 text-xs leading-6 text-app">
                  {previewState.textContent}
                </pre>
              )}
            </div>
          </div>
        </div>
      ) : null}

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
