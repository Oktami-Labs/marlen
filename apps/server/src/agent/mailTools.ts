import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ConnectedAccount, EmailThreadMessage } from "@marlen/shared";
import { Type } from "@sinclair/typebox";
import { errorMessage } from "../core/utils/util.js";
import { userTimezone } from "../db/settings.js";
import {
  getMailReadProvider,
  type MailMessageSummary,
  type MailSearch,
} from "../email/read/readProviders.js";
import { recallThread, rememberMessages } from "../email/read/seenMail.js";
import { snippetFrom, trimQuotedReply } from "../email/textUtils.js";
import { buildMailSourcesCard } from "./cards.js";
import {
  clampLimit,
  clampToolText,
  limitParam,
  numberedList,
  textResult,
  tool,
} from "./toolkit.js";

/**
 * Provider-neutral mail reading over the local MailReadProviders: one search
 * across every connected account, one thread in full. Every hit is remembered
 * (seenMail.ts) so publish_report can fill an item from its thread id.
 */

const SEARCH_DEFAULT_LIMIT = 20;
const SEARCH_MAX_LIMIT = 50;
const THREAD_DEFAULT_MESSAGES = 15;
const THREAD_MAX_MESSAGES = 50;
/** Per message body; the whole result is bounded by clampToolText on top. */
const BODY_MAX_CHARS = 6000;
const SNIPPET_CHARS = 160;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const SEARCH_TEXT_HINT = "Lower the limit or narrow the time window.";
const THREAD_TEXT_HINT = "Ask for fewer messages with maxMessages; the newest are kept.";

function stampFormat(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

/** `YYYY-MM-DD HH:mm` in the user's timezone; an unparseable date stays as it came. */
function stamp(iso: string, format: Intl.DateTimeFormat): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : format.format(new Date(ms)).replace(", ", " ");
}

/** The UTC offset `timeZone` has at `ms`. */
function zoneOffsetMs(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const field = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wallClock = Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    field("hour"),
    field("minute"),
    field("second"),
  );
  return wallClock - Math.floor(ms / 1000) * 1000;
}

/** UTC instant at which a calendar date starts in `timeZone`, including DST transitions. */
function localDayStart(value: string, timeZone: string): number {
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const wallClock = Date.UTC(year, month - 1, day);
  let instant = wallClock;
  // The offset can differ between the initial UTC guess and local midnight.
  // Iterating converges in two passes even on a transition day.
  for (let pass = 0; pass < 3; pass += 1) {
    instant = wallClock - zoneOffsetMs(instant, timeZone);
  }
  return instant;
}

function nextDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/**
 * An ISO bound. A bare date means that day in the user's timezone, its first
 * second for `start` and its last for `end`; null when unparseable.
 */
function parseBound(value: string, edge: "start" | "end", timeZone: string): string | null {
  const trimmed = value.trim();
  if (DATE_ONLY.test(trimmed)) {
    const [year, month, day] = trimmed.split("-").map(Number) as [number, number, number];
    if (new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) !== trimmed) {
      return null;
    }
    const dayStart = localDayStart(trimmed, timeZone);
    const instant = edge === "start" ? dayStart : localDayStart(nextDate(trimmed), timeZone) - 1;
    return new Date(instant).toISOString();
  }
  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function appLabel(account: ConnectedAccount): string {
  return `${account.name} (${account.appName ?? account.app})`;
}

function buildMailSearchTool(sessionId: string): AgentTool {
  return tool({
    name: "mail_search",
    label: "Search mail",
    description:
      "Find messages across the connected mail accounts in one call: newest first, one compact " +
      "row per message with its account, time, sender, subject, unread state, a body snippet and " +
      "the thread and message ids. Narrow by free text (the account's own search syntax passes " +
      "through), sender, a time window, unread only, or the folder. Read a hit in full with " +
      "mail_thread; a reply draft takes its threadId so it lands on the conversation, and the " +
      "account's attachment tools take its message id.",
    params: {
      query: Type.Optional(
        Type.String({
          description:
            "Free text over sender, subject and body; the account's own search operators work " +
            'too (e.g. "has:attachment").',
        }),
      ),
      from: Type.Optional(Type.String({ description: "Sender address or name." })),
      since: Type.Optional(
        Type.String({
          description:
            "Only messages received at or after this date (YYYY-MM-DD, the user's day) or " +
            "ISO date-time.",
        }),
      ),
      until: Type.Optional(
        Type.String({
          description:
            "Only messages received up to this date (YYYY-MM-DD, whole day) or ISO date-time.",
        }),
      ),
      unread: Type.Optional(Type.Boolean({ description: "Only unread messages." })),
      folder: Type.Optional(
        Type.Union([Type.Literal("inbox"), Type.Literal("sent"), Type.Literal("all")], {
          description: '"inbox" (default), "sent", or "all" folders.',
        }),
      ),
      limit: limitParam(SEARCH_DEFAULT_LIMIT, "messages per account"),
    },
    account: "optional",
    accountDescription:
      "Optional: only this account (its email address or id); default is every account.",
    execute: async (params, { account, accounts, accountTag, signal }) => {
      const timeZone = await userTimezone();
      const since = params.since ? parseBound(params.since, "start", timeZone) : undefined;
      if (since === null) return textResult(`since "${params.since}" is not a date.`);
      const until = params.until ? parseBound(params.until, "end", timeZone) : undefined;
      if (until === null) return textResult(`until "${params.until}" is not a date.`);

      const search: MailSearch = {
        ...(params.query?.trim() ? { text: params.query.trim() } : {}),
        ...(params.from?.trim() ? { from: params.from.trim() } : {}),
        ...(since ? { since } : {}),
        ...(until ? { until } : {}),
        ...(params.unread ? { unreadOnly: true } : {}),
        folder: params.folder ?? "inbox",
        limit: clampLimit(params.limit, SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT),
      };
      const targets = account ? [account] : accounts;
      if (targets.length === 0) return textResult("No email account is connected.");

      const notes: string[] = [];
      const rows: (MailMessageSummary & { accountId: string; accountName: string })[] = [];
      const cappedAccounts = new Set<string>();
      await Promise.all(
        targets.map(async (target) => {
          const provider = getMailReadProvider(target.app);
          if (!provider) {
            notes.push(`${appLabel(target)} has no mail search here; use its own find/list tools.`);
            return;
          }
          try {
            const found = await provider.searchMessages(target, search, signal);
            rememberMessages(sessionId, target.id, found);
            rows.push(
              ...found.map((message) => ({
                ...message,
                accountId: target.id,
                accountName: target.name,
              })),
            );
            if (found.length >= search.limit) cappedAccounts.add(target.name);
          } catch (error) {
            notes.push(`${target.name}: search failed (${errorMessage(error)}).`);
          }
        }),
      );
      rows.sort((a, b) => b.date.localeCompare(a.date));
      if (rows.length === 0) return textResult(["No messages match.", ...notes].join("\n"));

      const format = stampFormat(timeZone);
      const capped = [...cappedAccounts].sort();
      const header =
        `${rows.length} message${rows.length === 1 ? "" : "s"}, newest first` +
        (capped.length > 0
          ? ` (limit ${search.limit} reached in ${capped.join(", ")}; search each account again ` +
            `with until immediately before its oldest returned time)`
          : "") +
        ".";
      const list = numberedList(
        rows.map((row) => ({
          head:
            `${stamp(row.date, format)}${accountTag(row.accountId)} · ` +
            `${row.from || "(unknown sender)"} · ${row.subject || "(no subject)"}` +
            (row.unread ? " · unread" : ""),
          body: [
            row.snippet ? snippetFrom(row.snippet, SNIPPET_CHARS) : undefined,
            `thread ${row.threadId} · message ${row.messageId}`,
          ],
        })),
      );
      const text = clampToolText([header, ...notes, "", list].join("\n"), SEARCH_TEXT_HINT);
      return textResult(text, buildMailSourcesCard(params.query?.trim() ?? "", rows));
    },
  });
}

function summaryOfNewest(
  threadId: string,
  subject: string,
  newest: EmailThreadMessage,
): MailMessageSummary {
  return {
    messageId: newest.id ?? "",
    threadId,
    from: newest.from,
    to: newest.to,
    subject,
    date: newest.date,
    snippet: snippetFrom(newest.body, SNIPPET_CHARS),
    unread: newest.isUnread ?? false,
  };
}

function renderMessage(message: EmailThreadMessage, n: number, format: Intl.DateTimeFormat) {
  const body = trimQuotedReply(message.body);
  const shown =
    body.length > BODY_MAX_CHARS ? `${body.slice(0, BODY_MAX_CHARS)}\n[… message truncated]` : body;
  const head =
    `${n}. ${stamp(message.date, format)} · From: ${message.from || "(unknown)"} · ` +
    `To: ${message.to.join(", ") || "(none)"}` +
    (message.cc?.length ? ` · Cc: ${message.cc.join(", ")}` : "") +
    (message.id ? ` · message ${message.id}` : "");
  return `${head}\n${shown || "(empty body)"}`;
}

function buildMailThreadTool(sessionId: string): AgentTool {
  return tool({
    name: "mail_thread",
    label: "Read a thread",
    description:
      "Read one conversation in full, oldest message first: every message's time, sender, " +
      "recipients and body, quoted history trimmed. Takes the threadId from mail_search or a " +
      "report item; the account is inferred from that search, so pass it only when asked to. " +
      "A long thread keeps its newest messages; raise maxMessages for more.",
    params: {
      threadId: Type.String({ description: "The thread id from mail_search." }),
      maxMessages: limitParam(THREAD_DEFAULT_MESSAGES, "messages (the newest are kept)"),
    },
    account: "optional",
    accountDescription:
      "The account holding the thread (its email address or id); needed only when the thread " +
      "did not come from mail_search in this session.",
    execute: async ({ threadId: rawThreadId, maxMessages }, { account, accounts, signal }) => {
      const threadId = rawThreadId.trim();
      if (!threadId) return textResult("threadId is empty.");
      const seen = recallThread(sessionId, threadId);
      const target =
        account ??
        (seen ? accounts.find((a) => a.id === seen.accountId) : undefined) ??
        (accounts.length === 1 ? accounts[0] : undefined);
      if (!target) {
        return textResult(
          `Which account holds thread ${threadId}? Pass account: one of ` +
            `${accounts.map((a) => a.name).join(", ") || "(none connected)"}.`,
        );
      }
      const provider = getMailReadProvider(target.app);
      if (!provider) {
        return textResult(
          `${appLabel(target)} has no thread reader here; use its own get/find tools.`,
        );
      }
      const thread = await provider.getThread(target, threadId, signal);
      if (!thread) {
        return textResult(
          `No thread ${threadId} in ${target.name}. Thread ids come from mail_search; search ` +
            "again if it may have moved.",
        );
      }
      const keep = clampLimit(maxMessages, THREAD_DEFAULT_MESSAGES, THREAD_MAX_MESSAGES);
      const messages = thread.messages.slice(-keep);
      const newest = messages[messages.length - 1];
      const source = newest ? summaryOfNewest(threadId, thread.subject, newest) : undefined;
      if (source) rememberMessages(sessionId, target.id, [source]);

      const format = stampFormat(await userTimezone());
      const skipped = thread.messages.length - messages.length;
      const header =
        `Subject: ${thread.subject || "(no subject)"}\n` +
        `${thread.messages.length} message${thread.messages.length === 1 ? "" : "s"} in ` +
        `${target.name}, oldest first` +
        (skipped > 0 ? ` (the oldest ${skipped} not shown)` : "") +
        ".";
      const shown = messages.map((message, i) => renderMessage(message, skipped + i + 1, format));
      const text = clampToolText([header, ...shown].join("\n\n"), THREAD_TEXT_HINT);
      const card = source
        ? buildMailSourcesCard(thread.subject, [
            { ...source, accountId: target.id, accountName: target.name },
          ])
        : undefined;
      return textResult(text, card);
    },
  });
}

export function buildMailReadTools(sessionId: string): AgentTool[] {
  return [buildMailSearchTool(sessionId), buildMailThreadTool(sessionId)];
}
