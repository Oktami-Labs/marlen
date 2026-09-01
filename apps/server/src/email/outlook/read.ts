import type { ConnectedAccount, EmailThreadMessage } from "@marlen/shared";
import { upstreamStatusCode } from "../../core/errors.js";
import { proxyRequest } from "../../integrations/pipedream/connect.js";
import { sanitizeEmailHtml } from "../htmlBody.js";
import type {
  MailMessageSummary,
  MailReadProvider,
  MailSearch,
  SentMessage,
  ThreadDetail,
} from "../read/readProviders.js";
import { stripHtml } from "../textUtils.js";
import {
  fetchConversationMessages,
  formatRecipient,
  formatRecipients,
  GRAPH_API,
  type GraphRecipient,
} from "./message.js";

const DEFAULT_LIMIT = 50;

const SENT_SELECT = "subject,toRecipients,sentDateTime,body,conversationId";

const THREAD_SELECT = "subject,from,toRecipients,ccRecipients,receivedDateTime,body,isDraft";

const SEARCH_SELECT =
  "id,conversationId,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead";

const FOLDER_PATH: Record<MailSearch["folder"], string> = {
  inbox: "/mailFolders('inbox')/messages",
  sent: "/mailFolders('sentitems')/messages",
  all: "/messages",
};

/** `$search` results come ranked, not dated, and cannot carry `$filter`, so bounds apply here after over-fetching this many times the limit. */
const SEARCH_OVERFETCH = 3;
const SEARCH_PAGE_MAX = 100;

/** Display cap on a conversation view, not a paging unit. */
const THREAD_LIMIT = 50;

interface GraphSentMessage {
  id: string;
  conversationId?: string;
  subject?: string;
  toRecipients?: GraphRecipient[];
  sentDateTime?: string;
  body?: { contentType?: string; content?: string };
}

interface GraphThreadMessage {
  id: string;
  subject?: string;
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  receivedDateTime?: string;
  body?: { contentType?: string; content?: string };
  isDraft?: boolean;
}

interface GraphListResponse {
  value?: GraphSentMessage[];
  "@odata.nextLink"?: string;
}

interface GraphThreadListResponse {
  value?: GraphThreadMessage[];
  "@odata.nextLink"?: string;
}

interface GraphSummaryMessage {
  id: string;
  conversationId?: string;
  subject?: string;
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  receivedDateTime?: string;
  bodyPreview?: string;
  isRead?: boolean;
}

function isHtmlBody(message: { body?: { contentType?: string; content?: string } }): boolean {
  return message.body?.contentType?.toLowerCase() === "html";
}

function bodyTextOf(message: { body?: { contentType?: string; content?: string } }): string {
  const rawBody = message.body?.content ?? "";
  return isHtmlBody(message) ? stripHtml(rawBody) : rawBody.trim();
}

/** Graph hands back a whole HTML document; sanitizing keeps the body's markup. */
function bodyHtmlOf(message: {
  body?: { contentType?: string; content?: string };
}): string | undefined {
  const rawBody = message.body?.content ?? "";
  if (!isHtmlBody(message) || !rawBody) return undefined;
  return sanitizeEmailHtml(rawBody) || undefined;
}

function toSentMessage(message: GraphSentMessage): SentMessage {
  return {
    providerMessageId: message.id,
    providerThreadId: message.conversationId ?? message.id,
    subject: message.subject ?? "",
    to: formatRecipients(message.toRecipients),
    date: message.sentDateTime ?? new Date().toISOString(),
    bodyText: bodyTextOf(message),
  };
}

async function listSentSince(
  account: ConnectedAccount,
  sinceIso: string,
  opts?: { limit?: number; signal?: AbortSignal },
): Promise<SentMessage[]> {
  const limit = opts?.limit ?? DEFAULT_LIMIT;
  const messages: SentMessage[] = [];

  // Queried newest-first so the cap keeps the newest `limit`; reversed into oldest-first for return.
  let page = (await proxyRequest(
    account.id,
    "get",
    `${GRAPH_API}/mailFolders('sentitems')/messages`,
    {
      params: {
        $select: SENT_SELECT,
        $filter: `sentDateTime ge ${sinceIso}`,
        $orderby: "sentDateTime desc",
        $top: String(Math.min(limit, DEFAULT_LIMIT)),
      },
      signal: opts?.signal,
    },
  )) as GraphListResponse;

  for (;;) {
    for (const message of page.value ?? []) {
      messages.push(toSentMessage(message));
      if (messages.length >= limit) return messages.reverse();
    }
    const next = page["@odata.nextLink"];
    if (!next) return messages.reverse();
    page = (await proxyRequest(account.id, "get", next, {
      signal: opts?.signal,
    })) as GraphListResponse;
  }
}

async function newestInbound(
  account: ConnectedAccount,
  opts?: { knownId?: string; signal?: AbortSignal },
): Promise<{ id: string; date: string | null } | null> {
  // id and receivedDateTime come back together, so there's no second fetch for knownId to short-circuit.
  const page = (await proxyRequest(
    account.id,
    "get",
    `${GRAPH_API}/mailFolders('inbox')/messages`,
    {
      params: {
        $select: "id,receivedDateTime",
        $orderby: "receivedDateTime desc",
        $top: "1",
      },
      signal: opts?.signal,
    },
  )) as GraphThreadListResponse;
  const newest = page.value?.[0];
  if (!newest) return null;
  return { id: newest.id, date: newest.receivedDateTime ?? null };
}

async function getMessageBody(
  account: ConnectedAccount,
  providerMessageId: string,
  signal?: AbortSignal,
): Promise<string | null> {
  let message: GraphSentMessage;
  try {
    message = (await proxyRequest(account.id, "get", `${GRAPH_API}/messages/${providerMessageId}`, {
      params: { $select: "id,body" },
      signal,
    })) as GraphSentMessage;
  } catch (error) {
    if (upstreamStatusCode(error) === 404) return null;
    throw error;
  }
  return bodyTextOf(message);
}

function toSummary(message: GraphSummaryMessage): MailMessageSummary {
  return {
    messageId: message.id,
    threadId: message.conversationId ?? message.id,
    from: formatRecipient(message.from) ?? "",
    to: formatRecipients(message.toRecipients),
    subject: message.subject ?? "",
    date: message.receivedDateTime ?? "",
    snippet: (message.bodyPreview ?? "").replace(/\s+/g, " ").trim(),
    unread: message.isRead === false,
  };
}

function withinBounds(summary: MailMessageSummary, search: MailSearch): boolean {
  if (search.since && summary.date < search.since) return false;
  if (search.until && summary.date > search.until) return false;
  if (search.unreadOnly && !summary.unread) return false;
  return true;
}

/**
 * Free text and sender go through `$search` (KQL, which excludes `$filter`
 * and `$orderby`); a search without them uses `$filter`, whose first clause is
 * the `$orderby` property, as Graph requires.
 */
async function searchMessages(
  account: ConnectedAccount,
  search: MailSearch,
  signal?: AbortSignal,
): Promise<MailMessageSummary[]> {
  const url = `${GRAPH_API}${FOLDER_PATH[search.folder]}`;
  const kql = [
    search.text ?? "",
    ...(search.from ? search.from.split(/\s+/).map((term) => `from:${term}`) : []),
  ]
    .filter(Boolean)
    .join(" ");

  let params: Record<string, string>;
  if (kql) {
    params = {
      $search: `"${kql.replace(/"/g, "")}"`,
      $select: SEARCH_SELECT,
      $top: String(Math.min(search.limit * SEARCH_OVERFETCH, SEARCH_PAGE_MAX)),
    };
  } else {
    const clauses = [`receivedDateTime ge ${search.since ?? "1970-01-01T00:00:00Z"}`];
    if (search.until) clauses.push(`receivedDateTime le ${search.until}`);
    if (search.unreadOnly) clauses.push("isRead eq false");
    params = {
      $filter: clauses.join(" and "),
      $orderby: "receivedDateTime desc",
      $select: SEARCH_SELECT,
      $top: String(search.limit),
    };
  }

  const page = (await proxyRequest(account.id, "get", url, { params, signal })) as {
    value?: GraphSummaryMessage[];
  };
  return (page.value ?? [])
    .map(toSummary)
    .filter((summary) => withinBounds(summary, search))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, search.limit);
}

function toThreadMessage(message: GraphThreadMessage): EmailThreadMessage {
  const html = bodyHtmlOf(message);
  return {
    id: message.id,
    from: formatRecipient(message.from) ?? "",
    to: formatRecipients(message.toRecipients),
    ...(message.ccRecipients?.length ? { cc: formatRecipients(message.ccRecipients) } : {}),
    date: message.receivedDateTime ?? "",
    body: bodyTextOf(message),
    ...(html ? { bodyHtml: html } : {}),
  };
}

async function getThread(
  account: ConnectedAccount,
  providerThreadId: string,
  signal?: AbortSignal,
): Promise<ThreadDetail | null> {
  const messages = await fetchConversationMessages<GraphThreadMessage>(
    account,
    providerThreadId,
    THREAD_SELECT,
    THREAD_LIMIT,
    signal,
  );

  // Cull unsent drafts here, not in the OData $filter, which rejects some property combinations as inefficient; an unknown conversation just comes back empty.
  const exchanged = messages
    .filter((m) => !m.isDraft)
    .sort((a, b) => (a.receivedDateTime ?? "").localeCompare(b.receivedDateTime ?? ""));
  if (exchanged.length === 0) return null;

  return { subject: exchanged[0]?.subject ?? "", messages: exchanged.map(toThreadMessage) };
}

export const outlookReadProvider: MailReadProvider = {
  newestInbound,
  listSentSince,
  getMessageBody,
  getThread,
  searchMessages,
};
