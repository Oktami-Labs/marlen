import type { AgentCard, EmailRef } from "./cards.js";

export * from "./appSettings.js";
export * from "./cards.js";
export * from "./changelog.js";
export * from "./onoffice.js";
export * from "./whatsapp.js";

export const EMAIL_APPS = ["gmail", "microsoft_outlook", "zoho_mail", "imap"] as const;
export type EmailApp = (typeof EMAIL_APPS)[number];

export const EMAIL_APP_LABELS: Record<EmailApp, string> = {
  gmail: "Gmail",
  microsoft_outlook: "Outlook / Exchange (Microsoft 365)",
  zoho_mail: "Zoho Mail",
  imap: "IMAP (any other provider)",
};

export const POPULAR_APPS = [
  "notion",
  "slack_bot",
  "google_calendar",
  "google_drive",
  "github",
  "todoist",
  "whatsapp_business",
] as const;

export interface PipedreamApp {
  slug: string;
  name: string;
  imgSrc?: string;
}

export type ApiErrorCode = "pipedream_not_configured";

export interface PipedreamStatus {
  configured: boolean;
  mode: "custom" | "builtin";
  builtinAvailable: boolean;
  source: "settings" | "env" | null;
  clientId: string | null;
  projectId: string | null;
  environment: "development" | "production";
  hasClientSecret: boolean;
}

export interface PipedreamConfigInput {
  clientId: string;
  clientSecret?: string;
  project: string;
  environment?: "development" | "production";
}

export interface ConnectedAccount {
  id: string;
  app: string;
  appName?: string;
  imgSrc?: string;
  name: string;
  healthy: boolean;
  createdAt: string;
}

export interface AccountColor {
  accountId: string;
  hex: string;
}

/**
 * Who the assistant works for, as the user wrote it. The name and text ride in
 * the system prompt; the picture is a data URI shown only in the app's own UI.
 */
export interface UserProfile {
  name: string;
  about: string;
  avatar: string | null;
}

export type UserProfileText = Pick<UserProfile, "name" | "about">;

export const USER_PROFILE_NAME_MAX = 120;
export const USER_PROFILE_ABOUT_MAX = 2000;
export const USER_PROFILE_AVATAR_MAX_CHARS = 400_000;

export interface AccountSignature {
  accountId: string;
  html: string;
}

export const EMAIL_BODY_FONT_FAMILY = "Arial, Helvetica, sans-serif";

export const EMAIL_BODY_STYLE = {
  fontFamily: EMAIL_BODY_FONT_FAMILY,
  fontSize: "14px",
  lineHeight: "1.5",
} as const;

/** Keep pasted signature spacing instead of imposing the body line height. */
export const EMAIL_SIGNATURE_STYLE = { ...EMAIL_BODY_STYLE, lineHeight: "normal" } as const;

export function styleAttribute(style: Record<string, string>): string {
  return Object.entries(style)
    .map(
      ([property, value]) => `${property.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${value}`,
    )
    .join(";");
}

export interface AccountPermissions {
  accountId: string;
  write: boolean;
  send: boolean;
  delete: boolean;
}

/** Whole-filesystem capabilities available only in interactive sessions. */
export interface FileAccessSettings {
  read: boolean;
  write: boolean;
  bash: boolean;
}

export interface AccountVoice {
  accountId: string;
  learnedAt?: string;
  styleMemoryIds?: string[];
  /** Last machine-authored content hash for each generated style page. */
  generatedStyleHashes?: Record<string, string>;
}

export interface AccountVoiceInfo {
  accountId: string;
  learnedAt?: string;
  memoryId?: string;
  directives: string[];
}

export interface SearchResult {
  type: "chat" | "run" | "draft" | "document" | "wiki";
  id: string;
  title: string;
  snippet: string;
  date?: string;
  accountId?: string;
}

export interface ConnectTokenResponse {
  connectLinkUrl: string;
  expiresAt: string;
}

export type ConversationType = "chat" | "automation";

export interface Conversation {
  id: string;
  title: string;
  type?: ConversationType;
  createdAt: string;
  running?: boolean;
  focusAccountId?: string | null;
  focusThreadId?: string | null;
  focusThreadSubject?: string | null;
}

export type ConversationListItem = Conversation & {
  type: ConversationType;
  preview: string | null;
  updatedAt: string;
};

export interface ConversationListResponse {
  items: ConversationListItem[];
  total: number;
}

export interface ChatToolCall {
  id: string;
  name: string;
  label?: string;
  isError: boolean;
  done: boolean;
  detail?: string;
  parameters?: unknown;
  result?: unknown;
  contentOffset?: number;
  /** Assistant tool-use batch within the persisted turn; parallel calls share one. */
  batch?: number;
}

export type ChatAttachmentKind = "image" | "document";

/** Metadata shown with a chat message. The bytes stay on the local server. */
export interface ChatAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: ChatAttachmentKind;
}

/** Browser-to-server representation used only while sending a new message. */
export interface ChatAttachmentUpload extends ChatAttachment {
  data: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  cards?: MessageCard[];
  toolCalls?: ChatToolCall[];
  refs?: EmailRef[];
  attachments?: ChatAttachment[];
  memoryIds?: string[];
  error?: string;
}

/** Process-local snapshot of a durable server turn while it is still running. */
export interface LiveChatTurn {
  id: string;
  conversationId: string;
  content: string;
  createdAt: string;
  toolCalls: ChatToolCall[];
  cards: MessageCard[];
  thinking: boolean;
}

export interface SttResult {
  text: string;
}

export interface SttProviderOption {
  id: string;
  name: string;
  keyUrl: string;
  free: boolean;
}

export interface SttStatus {
  providerId: string | null;
  options: SttProviderOption[];
}

export interface MessageCard {
  toolCallId: string;
  card: AgentCard;
}

export interface Automation {
  id: string;
  name: string;
  instruction: string;
  /** Five-field cron expression; empty means manual-only. */
  schedule: string;
  enabled: boolean;
  showInActivity: boolean;
  /** At most one automation may be pinned; its latest successful run leads Home. */
  pinned: boolean;
  leadId: string | null;
  runOnNewMail: boolean;
  notifyOnCompletion: boolean;
  /** Ascending manual sort key. */
  position: number;
  createdAt: string;
  nextRunAt?: string | null;
  /** The newest run, for the list's state marks; not on a create or update response. */
  lastRun?: Pick<AutomationRun, "id" | "status" | "startedAt"> | null;
}

export type RunTrigger =
  | {
      kind: "todo";
      todoId: string;
      title: string;
      body: string;
      answer?: string;
      /** The draft an answered approval is about, so the run can act on it. */
      ref?: TodoRef;
    }
  | { kind: "mail"; accountNames: string[] }
  | { kind: "catchUp"; dueAt: string };

export interface AutomationRun {
  id: string;
  automationId: string;
  conversationId: string;
  status: "running" | "success" | "error";
  result: string;
  trigger: RunTrigger | null;
  startedAt: string;
  finishedAt: string | null;
  cards?: MessageCard[];
}

/**
 * One tool call of a run in flight. The trail is ephemeral: it lives only while
 * the run is running, and the finished run's calls persist on its assistant
 * message. A step with no `endedAt` is the one working right now.
 */
export interface RunStep {
  id: string;
  label: string;
  failed: boolean;
  startedAt: string;
  endedAt?: string;
}

export interface RunFeedItem extends AutomationRun {
  automationName: string | null;
  /** Present only while `status` is "running"; the tail of what it has done so far. */
  steps?: RunStep[];
}

export interface MissedAutomation {
  id: string;
  name: string;
  dueAt: string;
}

export type LeadSource = "email" | "manual" | "onoffice";

export type LeadPriority = "A" | "B" | "C" | "";

/**
 * Lifecycle: new = no outreach yet; contacted = we wrote, awaiting reply;
 * engaged = they replied; qualified = serious prospect; won/lost close it.
 */
export type LeadStatus = "new" | "contacted" | "engaged" | "qualified" | "won" | "lost";

export interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string;
  accountId: string;
  source: LeadSource;
  onofficeAddressId: string | null;
  status: LeadStatus;
  interest: string;
  persona: string;
  priority: LeadPriority;
  /** BCP-47 primary language subtag. */
  language: string;
  notes: string;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmailDraft {
  id: string;
  messageId: string;
  threadId: string;
  subject: string;
  to: string;
  date: string;
  webUrl: string;
  conversationId?: string;
  snippet?: string;
}

export interface AccountDrafts {
  account: string;
  accountId: string;
  drafts: EmailDraft[];
  error?: string;
}

export interface EmailDraftDetail {
  body: string;
  cc: string;
  bcc: string;
  signature?: string;
}

export type DraftProposalStatus = "proposed" | "kept" | "sent" | "discarded";

export interface DraftProposalStatusResult {
  status: DraftProposalStatus;
  accountId: string;
  draftId?: string;
}

export interface KeepDraftProposalResult {
  ok: true;
  accountId: string;
  draftId: string;
  webUrl?: string;
  sent: boolean;
}

export interface LlmProviderInfo {
  id: string;
  name: string;
  oauth: boolean;
  oauthName?: string;
  auth: "subscription" | "stored_key" | "env" | null;
  authDetail?: string;
  modelCount: number;
}

export interface LoginFlowStatus {
  providerId: string | null;
  providerName?: string;
  authUrl?: string;
  instructions?: string;
  deviceCode?: { userCode: string; verificationUri: string };
  prompt?: { message: string; placeholder?: string };
  select?: { message: string; options: { id: string; label: string }[] };
  done: boolean;
  error?: string;
}

export type ThinkingLevel = "off" | "medium" | "high";

export interface ModelInfo {
  id: string;
  name: string;
}

export interface ModelSettings {
  provider: string;
  model: string;
  reasoning: boolean;
  thinkingLevel: ThinkingLevel;
  catalog: { id: string; name: string; models: ModelInfo[] }[];
}

/** Normalized window ids are "5h", "week", or "week_<model>". */
export interface UsageWindow {
  id: string;
  usedPct: number;
  resetsAt: string | null;
}

export interface LlmUsage {
  provider: string;
  plan: string | null;
  windows: UsageWindow[];
}

export interface LlmUsageResponse {
  usages: LlmUsage[];
}

export interface LlmContextBreakdown {
  instructions: number;
  knowledge: number;
  skills: number;
  /** Provider-counted context outside the prompt and transcript. */
  tools: number;
  conversation: number;
}

export interface LlmContextUsage {
  usedPct: number;
  tokens: number;
  contextWindow: number;
  breakdown: LlmContextBreakdown;
}

export interface LlmContextResponse {
  context: LlmContextUsage | null;
}

export interface AppStatus {
  pipedreamConfigured: boolean;
  modelConfigured: boolean;
  emailAccounts: number;
  /** False when a configured account provider could not be reached. */
  emailAccountsKnown: boolean;
  onofficeConfigured: boolean;
  provider: string;
  model: string;
}

export function isSetupComplete(status: AppStatus): boolean {
  return status.modelConfigured && (status.emailAccounts > 0 || !status.emailAccountsKnown);
}

/** A page summary (the part riding the system prompt) is capped to this many characters there. */
export const WIKI_SUMMARY_MAX_LENGTH = 2000;

/** Cap for a whole page written through the tools and routes; hand-edited files may exceed it. */
export const WIKI_PAGE_MAX_LENGTH = 20_000;

export const WIKI_PAGE_MAX_COUNT = 1000;

/** The one page type with behavior attached: always indexed in the prompt, id stable on edit. */
export const WIKI_TYPE_SKILL = "skill";

/**
 * One wiki page: a markdown file in the agent home's wiki/ folder, the unit of
 * the agent's long-term memory. Scope is one of three states: global
 * (accountId and contactId both null), account-scoped, or contact-scoped,
 * never both set. `type` is advisory ("person", "recipe", …) except "skill".
 */
export interface WikiPage {
  id: string;
  /** Opaque version of the editable fields, used to reject stale replacements. */
  revision: string;
  type: string | null;
  content: string;
  source: "user" | "agent";
  accountId: string | null;
  contactId: string | null;
  /** User-selected pages whose summaries stay in every system prompt. */
  pinned: boolean;
  usedCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A page is summary + body: the summary (up to the first blank line) rides the
 * system prompt, the body stays on disk behind page_read.
 */
export function splitPage(content: string): { summary: string; body: string } {
  const trimmed = content.trim();
  const gap = trimmed.search(/\n[ \t]*\n/);
  if (gap === -1) return { summary: trimmed, body: "" };
  return { summary: trimmed.slice(0, gap).trim(), body: trimmed.slice(gap).trim() };
}

export interface LearnRun {
  id: string;
  reason: "boot" | "scheduled";
  status: "ok" | "error";
  matched: number;
  pending: number;
  identical: number;
  learned: number;
  lessons: number;
  error: string | null;
  startedAt: string;
  finishedAt: string;
}

export interface LearnStatus {
  runs: LearnRun[];
  nextRunAt: string | null;
}

/** One retryable voice-learning result per account. */
export interface VoiceLearnRun {
  accountId: string;
  status: "running" | "ok" | "error";
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface LibraryDocument {
  id: string;
  path: string;
  title: string;
  ext: string;
  size: number;
  status: "indexed" | "error";
  error: string | null;
  chunkCount: number;
  textLength: number;
  modifiedAt: string;
  indexedAt: string;
}

export interface LibraryStatus {
  folder: string;
  folders: string[];
  documents: LibraryDocument[];
}

export interface LibrarySearchHit {
  id: string;
  title: string;
  path: string;
  ext: string;
  snippet: string;
}

export interface LibraryDocumentContent {
  content: string;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export interface CreatedDraft {
  draftId: string;
  messageId: string;
  threadId: string;
  webUrl: string;
}

export type TodoStatus = "open" | "done" | "dismissed";

/** One answer the user can give a todo with a single click. */
export interface TodoOption {
  label: string;
  detail?: string;
}

/**
 * What an agenda row is. A "todo" is the agent's or the user's own item; an
 * "approval" wraps a draft awaiting the user's send, filed and closed by the
 * draft's own store, so its title and status follow the draft.
 */
export type TodoKind = "todo" | "approval";

/** The draft an approval wraps, snapshotted for the row; the draft stays the source of truth. */
export type TodoRef =
  | {
      kind: "email_draft";
      accountId: string;
      account: string;
      draftId: string;
      to: string;
      webUrl: string;
      snippet?: string;
    }
  | { kind: "outbound"; outboundId: string; channel: string; targetLabel: string; body: string };

export interface Todo {
  id: string;
  kind: TodoKind;
  /** Set on an approval, null on a todo. */
  ref: TodoRef | null;
  title: string;
  /** The agent's note; on an approval, its question about the draft. */
  body: string;
  status: TodoStatus;
  dueAt: string | null;
  position: number;
  conversationId: string | null;
  linkedAutomationId: string | null;
  /** A closed set of answers; empty for a plain todo. */
  options: TodoOption[];
  /** The option the user chose when completing it. */
  answer: string | null;
  createdAt: string;
  updatedAt: string;
}

export type OutboundStatus = "open" | "sent" | "discarded";

export const OUTBOUND_CHANNEL_LABELS: Record<string, string> = { whatsapp: "WhatsApp" };

/** A pending message for a channel without provider-native drafts. */
export interface OutboundDraft {
  id: string;
  channel: string;
  target: string;
  targetLabel: string;
  body: string;
  status: OutboundStatus;
  sentRef: string | null;
  conversationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ServerEventTopic =
  | "runs"
  | "drafts"
  | "outbound"
  | "todos"
  | "wiki"
  | "library"
  | "conversations"
  | "chat"
  | "automations"
  | "learn"
  | "leads"
  | "whatsapp"
  | "accounts"
  | "settings"
  | "seen"
  | "notification";

/** Items newer than `floor` remain new until their key appears in `keys`. */
export interface SeenState {
  floor: string;
  keys: string[];
}

export interface RunNotification {
  runId: string;
  automationId: string;
  automationName: string;
  status: "success" | "error";
  summary: string;
}

export interface ServerEvent {
  topic: ServerEventTopic;
  notification?: RunNotification;
}

export type ChatStreamEvent =
  | { type: "conversation"; conversationId: string }
  | { type: "text_delta"; delta: string }
  | { type: "thinking" }
  | {
      type: "tool_start";
      toolCallId: string;
      toolName: string;
      toolLabel: string;
      parameters?: unknown;
      contentOffset: number;
    }
  | { type: "tool_update"; toolCallId: string; toolName: string; detail: string }
  | { type: "tool_end"; toolCallId: string; toolName: string; isError: boolean; result?: unknown }
  | { type: "card"; toolCallId: string; card: AgentCard }
  | { type: "done"; text: string }
  /** The user stopped the turn; `text` is the capped transcript row. */
  | { type: "stopped"; text: string }
  | { type: "error"; message: string; kind?: "rate_limit" };
