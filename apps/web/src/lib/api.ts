import type {
  AccountColor,
  AccountDrafts,
  AccountPermissions,
  AccountSignature,
  AccountVoiceInfo,
  ApiErrorCode,
  AppStatus,
  Automation,
  AutomationRun,
  ChatAttachmentUpload,
  ChatMessage,
  ChatStreamEvent,
  ConnectedAccount,
  ConnectTokenResponse,
  Conversation,
  ConversationListResponse,
  ConversationType,
  DraftProposalStatusResult,
  DraftRewriteResult,
  EmailDraftDetail,
  EmailRef,
  EmailThreadMessage,
  FileAccessSettings,
  KeepDraftProposalResult,
  Language,
  Lead,
  LeadStatus,
  LibraryDocumentContent,
  LibrarySearchHit,
  LibraryStatus,
  LiveChatTurn,
  LlmContextResponse,
  LlmProviderInfo,
  LlmUsageResponse,
  LoginFlowStatus,
  MailSearchResponse,
  MissedAutomation,
  ModelSettings,
  OnOfficeConfigInput,
  OnOfficeStatus,
  OutboundDraft,
  OutboundStatus,
  PinnedRun,
  PipedreamApp,
  PipedreamConfigInput,
  PipedreamStatus,
  RunFeedItem,
  SearchResult,
  SeenState,
  SttResult,
  SttStatus,
  ThinkingLevel,
  Todo,
  TodoStatus,
  UserProfile,
  UserProfileText,
  VoiceLearnRun,
  WhatsAppStatus,
  WikiPage,
} from "@marlen/shared";
import i18n from "@/lib/i18n";
import { openExternal } from "@/lib/utils";

interface DraftStatusResult {
  status: "open" | "sent" | "discarded";
  sentMessageId?: string;
}

/** An API failure with machine-readable status and remediation code. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: ApiErrorCode,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

export function isPipedreamMissing(error: unknown): boolean {
  return error instanceof ApiError && error.code === "pipedream_not_configured";
}

function statusMessage(status: number): string {
  if (status === 401 || status === 403) return i18n.t("errors.forbidden");
  if (status === 404) return i18n.t("errors.notFound");
  if (status === 408 || status === 504) return i18n.t("errors.timeout");
  if (status === 502 || status === 503) return i18n.t("errors.unavailable");
  if (status >= 500) return i18n.t("errors.server");
  return i18n.t("errors.request");
}

async function throwOnError(res: Response): Promise<void> {
  if (res.ok) return;
  console.error(`API ${res.status} ${res.statusText}: ${res.url}`);
  let message = statusMessage(res.status);
  let code: ApiErrorCode | undefined;
  try {
    const data = (await res.json()) as { error?: string; code?: ApiErrorCode };
    if (data.error) message = data.error;
    code = data.code;
  } catch {
    // Keep the status-class message when the server returns no JSON envelope.
  }
  throw new ApiError(message, res.status, code);
}

/** Translate network failures without hiding cancellations. */
async function guardedFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    console.error(`API request failed: ${url}`, err);
    throw new Error(i18n.t("errors.network"));
  }
}

async function http<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await guardedFetch(url, {
    method,
    ...(body !== undefined && {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
  await throwOnError(res);
  return res.json() as Promise<T>;
}

const get = <T>(url: string) => http<T>("GET", url);

export const api = {
  status: () => get<AppStatus>("/api/status"),

  language: () => get<{ language: Language | null }>("/api/settings/language"),
  setLanguage: (language: Language) =>
    http<{ language: Language }>("PUT", "/api/settings/language", { language }),

  timezone: () => get<{ timezone: string | null }>("/api/settings/timezone"),
  setTimezone: (timezone: string) =>
    http<{ timezone: string }>("PUT", "/api/settings/timezone", { timezone }),

  profile: () => get<{ profile: UserProfile }>("/api/settings/profile"),
  setProfile: (text: UserProfileText) =>
    http<{ profile: UserProfile }>("PUT", "/api/settings/profile", text),
  setProfileAvatar: (dataUri: string) =>
    http<{ profile: UserProfile }>("PUT", "/api/settings/profile/avatar", { dataUri }),
  removeProfileAvatar: () =>
    http<{ profile: UserProfile }>("DELETE", "/api/settings/profile/avatar"),

  accountPermissions: () => get<{ permissions: AccountPermissions[] }>("/api/settings/permissions"),
  setAccountPermissions: (permissions: AccountPermissions[]) =>
    http<{ permissions: AccountPermissions[] }>("PUT", "/api/settings/permissions", {
      permissions,
    }),

  fileAccess: () => get<{ fileAccess: FileAccessSettings }>("/api/settings/file-access"),
  setFileAccess: (fileAccess: FileAccessSettings) =>
    http<{ fileAccess: FileAccessSettings }>("PUT", "/api/settings/file-access", fileAccess),

  accountColors: () => get<{ colors: AccountColor[] }>("/api/settings/account-colors"),
  setAccountColors: (colors: AccountColor[]) =>
    http<{ colors: AccountColor[] }>("PUT", "/api/settings/account-colors", { colors }),

  signatureImage: (url: string) =>
    http<{ dataUri: string }>("POST", "/api/settings/signature-image", { url }),
  accountSignatures: () =>
    get<{ signatures: AccountSignature[] }>("/api/settings/account-signatures"),
  setAccountSignatures: (signatures: AccountSignature[]) =>
    http<{ signatures: AccountSignature[] }>("PUT", "/api/settings/account-signatures", {
      signatures,
    }),

  llmProviders: () => get<LlmProviderInfo[]>("/api/llm/providers"),
  modelSettings: () => get<ModelSettings>("/api/llm/model"),
  setModel: (provider: string, model: string) =>
    http<ModelSettings>("PUT", "/api/llm/model", { provider, model }),
  setThinkingLevel: (level: ThinkingLevel) =>
    http<ModelSettings>("PUT", "/api/llm/thinking", { level }),
  llmUsage: () => get<LlmUsageResponse>("/api/llm/usage"),
  llmContext: (conversationId: string) =>
    get<LlmContextResponse>(`/api/llm/context?conversation=${encodeURIComponent(conversationId)}`),
  loginStatus: () => get<LoginFlowStatus>("/api/llm/login/status"),
  loginStart: (providerId: string) =>
    http<LoginFlowStatus>("POST", "/api/llm/login/start", { providerId }),
  loginInput: (value: string) => http<{ ok: boolean }>("POST", "/api/llm/login/input", { value }),
  loginSelect: (optionId: string) =>
    http<{ ok: boolean }>("POST", "/api/llm/login/select", { optionId }),
  loginCancel: () => http<{ ok: boolean }>("POST", "/api/llm/login/cancel"),
  saveApiKey: (providerId: string, apiKey: string) =>
    http<{ ok: boolean }>("POST", "/api/llm/key", { providerId, apiKey }),
  llmLogout: (providerId: string) =>
    http<{ ok: boolean }>("POST", "/api/llm/logout", { providerId }),

  pipedreamStatus: () => get<PipedreamStatus>("/api/pipedream"),
  savePipedream: (body: PipedreamConfigInput) =>
    http<PipedreamStatus>("PUT", "/api/pipedream", body),
  clearPipedream: () => http<PipedreamStatus>("DELETE", "/api/pipedream"),
  setPipedreamMode: (useCustom: boolean) =>
    http<PipedreamStatus>("PUT", "/api/pipedream/mode", { useCustom }),
  pipedreamAccounts: () => get<ConnectedAccount[]>("/api/pipedream/accounts"),
  syncPipedreamAccounts: () => http<ConnectedAccount[]>("POST", "/api/pipedream/accounts/sync"),
  pipedreamApps: (q: string) =>
    get<PipedreamApp[]>(`/api/pipedream/apps?q=${encodeURIComponent(q)}`),
  pipedreamConnectToken: (app: string) =>
    http<ConnectTokenResponse>("POST", "/api/pipedream/accounts/connect-token", { app }),
  deletePipedreamAccount: (id: string) =>
    http<{ ok: boolean }>("DELETE", `/api/pipedream/accounts/${encodeURIComponent(id)}`),
  learnAccountVoice: (id: string) =>
    http<{ ok: boolean }>("POST", `/api/pipedream/accounts/${encodeURIComponent(id)}/learn-voice`),
  voiceLearnRuns: () => get<VoiceLearnRun[]>("/api/learn/voice-runs"),
  accountVoices: () => get<AccountVoiceInfo[]>("/api/learn/voices"),

  onOfficeStatus: () => get<OnOfficeStatus>("/api/onoffice"),
  saveOnOffice: (body: OnOfficeConfigInput) => http<OnOfficeStatus>("PUT", "/api/onoffice", body),
  clearOnOffice: () => http<OnOfficeStatus>("DELETE", "/api/onoffice"),
  setOnOfficeAutomationCreates: (enabled: boolean) =>
    http<OnOfficeStatus>("PUT", "/api/onoffice/automation-creates", { enabled }),
  setOnOfficeWriteAccess: (enabled: boolean) =>
    http<OnOfficeStatus>("PUT", "/api/onoffice/write-access", { enabled }),

  whatsAppStatus: () => get<WhatsAppStatus>("/api/whatsapp"),
  whatsAppConnect: () => http<WhatsAppStatus>("POST", "/api/whatsapp/connect"),
  whatsAppUnlink: () => http<WhatsAppStatus>("DELETE", "/api/whatsapp"),
  setWhatsAppSendAccess: (enabled: boolean) =>
    http<WhatsAppStatus>("PUT", "/api/whatsapp/send-access", { enabled }),

  outbound: (status?: OutboundStatus) =>
    get<OutboundDraft[]>(`/api/outbound${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  sendOutbound: (id: string) =>
    http<{ ok: boolean }>("POST", `/api/outbound/${encodeURIComponent(id)}/send`),
  updateOutbound: (id: string, patch: { body?: string }) =>
    http<{ ok: boolean }>("PATCH", `/api/outbound/${encodeURIComponent(id)}`, patch),
  discardOutbound: (id: string) =>
    http<{ ok: boolean }>("DELETE", `/api/outbound/${encodeURIComponent(id)}`),
  outboundStatus: (id: string) =>
    get<{ status: OutboundStatus; sentRef?: string }>(
      `/api/outbound/${encodeURIComponent(id)}/status`,
    ),

  search: (q: string) => get<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(q)}`),

  runsFeed: (params?: { q?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set("q", params.q);
    if (params?.limit !== undefined) qs.set("limit", String(params.limit));
    if (params?.offset !== undefined) qs.set("offset", String(params.offset));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return get<{ items: RunFeedItem[]; total: number }>(`/api/runs${suffix}`);
  },
  pinnedRuns: () => get<{ items: PinnedRun[] }>("/api/runs/pinned"),
  missedRuns: () => get<{ items: MissedAutomation[] }>("/api/runs/missed"),
  runMissed: () => http<{ started: MissedAutomation[] }>("POST", "/api/runs/catch-up"),
  handleReportItem: (runId: string, key: string) =>
    http<{ ok: boolean }>("POST", `/api/runs/${encodeURIComponent(runId)}/report-items/handled`, {
      key,
    }),
  drafts: (opts?: { refresh?: boolean }) =>
    get<AccountDrafts[]>(`/api/drafts${opts?.refresh ? "?refresh=1" : ""}`),
  draftDetail: (accountId: string, draftId: string) =>
    get<EmailDraftDetail>(
      `/api/drafts/${encodeURIComponent(accountId)}/${encodeURIComponent(draftId)}`,
    ),
  keepProposal: (proposalId: string, opts?: { send?: boolean }) =>
    http<KeepDraftProposalResult>(
      "POST",
      `/api/draft-proposals/${encodeURIComponent(proposalId)}/keep`,
      opts ?? {},
    ),
  discardProposal: (proposalId: string) =>
    http<{ ok: boolean }>("DELETE", `/api/draft-proposals/${encodeURIComponent(proposalId)}`),
  proposalStatus: (proposalId: string) =>
    get<DraftProposalStatusResult>(`/api/draft-proposals/${encodeURIComponent(proposalId)}/status`),
  deleteDraft: (accountId: string, draftId: string) =>
    http<{ ok: boolean }>(
      "DELETE",
      `/api/drafts/${encodeURIComponent(accountId)}/${encodeURIComponent(draftId)}`,
    ),
  updateDraft: (
    accountId: string,
    draftId: string,
    patch: { body?: string; subject?: string; to?: string; cc?: string; bcc?: string },
  ) =>
    http<{ ok: boolean }>(
      "PATCH",
      `/api/drafts/${encodeURIComponent(accountId)}/${encodeURIComponent(draftId)}`,
      patch,
    ),
  rewriteDraft: (
    accountId: string,
    input: { instruction: string; body: string; subject: string },
  ) =>
    http<DraftRewriteResult>("POST", `/api/drafts/${encodeURIComponent(accountId)}/rewrite`, input),
  sendDraft: (accountId: string, draftId: string) =>
    http<{ ok: boolean }>(
      "POST",
      `/api/drafts/${encodeURIComponent(accountId)}/${encodeURIComponent(draftId)}/send`,
    ),
  draftStatus: (accountId: string, draftId: string) =>
    get<DraftStatusResult>(
      `/api/drafts/${encodeURIComponent(accountId)}/${encodeURIComponent(draftId)}/status`,
    ),
  conversations: (
    params: { q?: string; type?: ConversationType; limit?: number; offset?: number } = {},
  ) => {
    const search = new URLSearchParams();
    if (params.q) search.set("q", params.q);
    if (params.type) search.set("type", params.type);
    if (params.limit !== undefined) search.set("limit", String(params.limit));
    if (params.offset !== undefined) search.set("offset", String(params.offset));
    const qs = search.toString();
    return get<ConversationListResponse>(`/api/conversations${qs ? `?${qs}` : ""}`);
  },
  conversation: (id: string) => get<Conversation>(`/api/conversations/${encodeURIComponent(id)}`),
  conversationMessages: (id: string) =>
    get<ChatMessage[]>(`/api/conversations/${encodeURIComponent(id)}/messages`),
  systemPrompt: () => get<{ prompt: string }>("/api/chat/system-prompt"),
  stopChat: (id: string) =>
    http<{ stopped: boolean }>("POST", `/api/chat/${encodeURIComponent(id)}/stop`),
  liveChat: (id: string) =>
    get<{ turn: LiveChatTurn | null }>(`/api/chat/${encodeURIComponent(id)}/live`),

  sttStatus: () => get<SttStatus>("/api/stt"),
  transcribe: (audio: string, mimeType: string, language: string) =>
    http<SttResult>("POST", "/api/stt", { audio, mimeType, language }),

  renameConversation: (id: string, title: string) =>
    http<{ ok: boolean }>("PATCH", `/api/conversations/${encodeURIComponent(id)}`, { title }),
  setConversationFocus: (id: string, focusAccountId: string | null) =>
    http<{ ok: boolean }>("PATCH", `/api/conversations/${encodeURIComponent(id)}`, {
      focusAccountId,
    }),
  deleteConversation: (id: string) =>
    http<{ ok: boolean }>("DELETE", `/api/conversations/${encodeURIComponent(id)}`),

  automations: () => get<Automation[]>("/api/automations"),
  createAutomation: (body: {
    name: string;
    instruction: string;
    schedule: string;
    showInActivity?: boolean;
    runOnNewMail?: boolean;
    notifyOnCompletion?: boolean;
  }) => http<Automation>("POST", "/api/automations", body),
  updateAutomation: (id: string, body: Partial<Automation>) =>
    http<Automation>("PATCH", `/api/automations/${encodeURIComponent(id)}`, body),
  setAutomationPinned: (id: string, pinned: boolean) =>
    http<Automation>("PATCH", `/api/automations/${encodeURIComponent(id)}`, { pinned }),
  deleteAutomation: (id: string) =>
    http<{ ok: boolean }>("DELETE", `/api/automations/${encodeURIComponent(id)}`),
  runAutomation: (id: string) =>
    http<{ ok: boolean }>("POST", `/api/automations/${encodeURIComponent(id)}/run`),
  automationRuns: (id: string) =>
    get<AutomationRun[]>(`/api/automations/${encodeURIComponent(id)}/runs`),

  leads: (status?: LeadStatus) =>
    get<Lead[]>(`/api/leads${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  recordLead: (body: {
    email: string;
    name?: string;
    phone?: string;
    interest?: string;
    notes?: string;
  }) => http<{ lead: Lead; created: boolean }>("POST", "/api/leads", body),
  updateLead: (id: string, patch: Partial<Omit<Lead, "id" | "email" | "source">>) =>
    http<Lead>("PATCH", `/api/leads/${encodeURIComponent(id)}`, patch),
  deleteLead: (id: string) =>
    http<{ ok: boolean }>("DELETE", `/api/leads/${encodeURIComponent(id)}`),
  leadAutomations: (id: string) =>
    get<Automation[]>(`/api/leads/${encodeURIComponent(id)}/automations`),

  todos: (status?: TodoStatus) =>
    get<Todo[]>(`/api/todos${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  createTodo: (body: { title: string; body?: string; dueAt?: string }) =>
    http<Todo>("POST", "/api/todos", body),
  updateTodo: (
    id: string,
    patch: {
      title?: string;
      body?: string;
      status?: TodoStatus;
      dueAt?: string | null;
      position?: number;
      linkedAutomationId?: string | null;
      answer?: string;
    },
  ) => http<Todo>("PATCH", `/api/todos/${encodeURIComponent(id)}`, patch),

  seen: () => get<SeenState>("/api/seen"),
  markSeen: (keys: string[]) => http<SeenState>("POST", "/api/seen", { keys }),
  markAllSeen: () => http<SeenState>("POST", "/api/seen", { all: true }),

  wiki: () => get<WikiPage[]>("/api/wiki"),
  addPage: (
    content: string,
    opts: {
      name?: string;
      type?: string | null;
      accountId?: string | null;
      pinned?: boolean;
    } = {},
  ) => http<WikiPage>("POST", "/api/wiki", { content, ...opts }),
  updatePage: (
    id: string,
    content: string,
    baseRevision: string,
    opts: {
      accountId?: string | null;
      contactId?: string | null;
      pinned?: boolean;
    } = {},
  ) =>
    http<WikiPage>("PUT", `/api/wiki/${encodeURIComponent(id)}`, {
      content,
      baseRevision,
      ...opts,
    }),
  deletePage: (id: string) =>
    http<{ ok: boolean }>("DELETE", `/api/wiki/${encodeURIComponent(id)}`),

  library: () => get<LibraryStatus>("/api/library"),
  documentContent: (id: string) =>
    get<LibraryDocumentContent>(`/api/library/documents/${encodeURIComponent(id)}/content`),
  saveDocumentContent: (id: string, content: string) =>
    http<LibraryStatus>("PUT", `/api/library/documents/${encodeURIComponent(id)}/content`, {
      content,
    }),
  deleteLibraryDocument: (id: string) =>
    http<LibraryStatus>("DELETE", `/api/library/documents/${encodeURIComponent(id)}`),
  searchLibrary: (q: string) =>
    get<{ results: LibrarySearchHit[] }>(`/api/library/search?q=${encodeURIComponent(q)}`),
  // Uploads use a raw body rather than the JSON helper.
  uploadLibraryFile: async (file: File, dir?: string): Promise<LibraryStatus> => {
    const target = dir ? `&dir=${encodeURIComponent(dir)}` : "";
    const res = await guardedFetch(
      `/api/library/files?name=${encodeURIComponent(file.name)}${target}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
      },
    );
    await throwOnError(res);
    return res.json() as Promise<LibraryStatus>;
  },
  createLibraryFolder: (path: string) =>
    http<LibraryStatus>("POST", "/api/library/folders", { path }),
  deleteLibraryFolder: (path: string) =>
    http<LibraryStatus>("DELETE", `/api/library/folders?path=${encodeURIComponent(path)}`),
  openLibraryDocument: (id: string): void => {
    openExternal(`/api/library/documents/${encodeURIComponent(id)}/open`);
  },
  downloadLibraryDocument: (id: string): void => {
    openExternal(`/api/library/documents/${encodeURIComponent(id)}/open?download=1`);
  },
  revealLibraryFolder: (path: string) =>
    http<{ ok: boolean }>("POST", "/api/library/reveal", { path }),
  threadDetail: (accountId: string, threadId: string) =>
    get<{ subject: string; messages: EmailThreadMessage[] }>(
      `/api/mail/threads?accountId=${encodeURIComponent(accountId)}` +
        `&threadId=${encodeURIComponent(threadId)}`,
    ),
  searchMail: (q: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({ q, limit: "12" });
    return guardedFetch(`/api/mail/search?${params.toString()}`, { signal }).then(async (res) => {
      await throwOnError(res);
      return res.json() as Promise<MailSearchResponse>;
    });
  },
  mailAttachmentUrl: (accountId: string, messageId: string, filename: string): string =>
    `/api/mail/attachments/open?accountId=${encodeURIComponent(accountId)}` +
    `&messageId=${encodeURIComponent(messageId)}&filename=${encodeURIComponent(filename)}`,
  chatAttachmentUrl: (id: string): string => `/api/chat/attachments/${encodeURIComponent(id)}`,
  saveMailAttachment: (accountId: string, messageId: string, filename: string) =>
    http<{ saved: string }>("POST", "/api/mail/attachments/save", {
      accountId,
      messageId,
      filename,
    }),
  downloadDataExport: (): void => {
    openExternal("/api/backup");
  },
};

/** Stream chat events until the server closes the response. */
export async function streamChat(
  body: {
    conversationId?: string;
    message: string;
    refs?: EmailRef[];
    attachments?: ChatAttachmentUpload[];
    focusAccountId?: string | null;
  },
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await guardedFetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  await throwOnError(res);
  if (!res.body) throw new Error(i18n.t("errors.chatStream"));

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminalEvent = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of frame.split("\n")) {
        if (line.startsWith("data: ")) {
          let event: ChatStreamEvent;
          try {
            event = JSON.parse(line.slice(6)) as ChatStreamEvent;
          } catch {
            throw new Error(i18n.t("errors.chatStream"));
          }
          if (event.type === "done" || event.type === "error" || event.type === "stopped") {
            terminalEvent = true;
          }
          onEvent(event);
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }

  if (!terminalEvent) throw new Error(i18n.t("errors.chatStream"));
}
