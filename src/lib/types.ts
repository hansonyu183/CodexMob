export type ChatRole = "user" | "assistant" | "system";

export type MessageStatus = "streaming" | "done" | "error";

export interface Conversation {
  id: string;
  title: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  status: MessageStatus;
}

export interface AppSettings {
  theme: "dark" | "light";
  defaultModel: string;
  accessCode: string;
  runtimeStatus?: RuntimeAuthStatus;
  lastErrorCode?: ApiErrorCode;
}

export interface ChatRequestPayload {
  conversationId?: string;
  cwd?: string;
  model: string;
  input: string;
  mode?: ChatMode;
  attachments?: UploadItem[];
}

export type ChatMode = "default" | "plan";

export interface UploadItem {
  id: string;
  name: string;
  path: string;
  kind: "image" | "text";
  size: number;
}

export interface StreamStatusEvent {
  phase: string;
  detail?: string;
}

export interface StreamToolEvent {
  name: string;
  state: "start" | "end";
  summary?: string;
}

export interface ChatUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
}

export interface RuntimeAuthStatus {
  ready: boolean;
  loginMethod: "chatgpt" | "api" | "none";
  message?: string;
}

export interface ModelsResponse {
  defaultModel: string;
  models: string[];
}

export type ApiErrorCode =
  | "AUTH_REQUIRED"
  | "ACCESS_DENIED"
  | "RATE_LIMITED"
  | "INVALID_REQUEST"
  | "UPSTREAM_ERROR"
  | "INTERNAL_ERROR";

export interface ApiErrorShape {
  code: ApiErrorCode;
  message: string;
}

export type SourceKind = "codex_active" | "codex_archived";

export type RevisionToken = number;

export interface HistoryConversation {
  id: string;
  title: string;
  updatedAt: string;
  source: SourceKind;
  cwd: string | null;
  archived: boolean;
  model?: string;
}

export interface HistoryMessage {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  source: SourceKind;
}

export interface SyncState {
  latestRev: RevisionToken;
  lastSyncedAt?: string;
}

export interface SyncRunRequest {
  mode: "startup" | "manual";
  cwdFilter?: string;
}

export interface SyncRunResponse {
  syncedSessions: number;
  syncedMessages: number;
  latestRev: RevisionToken;
  durationMs: number;
}
