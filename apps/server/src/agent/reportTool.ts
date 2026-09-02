import type { AgentTool } from "@earendil-works/pi-agent-core";
import type {
  CardAccount,
  ConnectedAccount,
  ReportItem,
  ReportRef,
  ReportSection,
} from "@marlen/shared";
import { Type } from "@sinclair/typebox";
import { recallThread, seenMessageCount } from "../email/read/seenMail.js";
import { parseMailbox } from "../email/textUtils.js";
import { threadWebUrl } from "../email/webLinks.js";
import { listAccounts } from "../integrations/pipedream/connect.js";
import { reconcileReportCard } from "../services/automations/reportState.js";
import { findAccount } from "./accounts.js";
import {
  buildReportCard,
  cardNote,
  coerceReportItem,
  coerceReportSection,
  toCardAccount,
} from "./cards.js";
import { textResult, tool } from "./toolkit.js";

const REPORT_CARD_NOTE = cardNote(
  "this report",
  "Do not repeat its items in prose. Close with one line naming what needs the user first and " +
    "anything the run could not check. Say all is quiet only when coverage was complete and " +
    "nothing needs the user.",
);

/** The model supplies judgment; email facts are resolved from the session's mail reads. */
const itemParam = Type.Object({
  threadId: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        "Email item: the thread id exactly as mail_search or mail_thread returned it. Account, " +
        "sender, subject, message id, time and link are resolved from that result.",
    }),
  ),
  account: Type.Optional(
    Type.String({
      description:
        "The account email or id, needed only when the same thread id appeared in more than " +
        "one account.",
    }),
  ),
  url: Type.Optional(
    Type.String({ minLength: 1, description: "Web item: the address the row opens." }),
  ),
  title: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        "The row's lead text for a web or plain item (a lead's name, a document, a task). An " +
        "email item takes its subject instead.",
    }),
  ),
  gist: Type.String({
    minLength: 1,
    description:
      'One line, never a sentence: "topic: key fact → action" when it needs the user — e.g. ' +
      '"contract: signs Fri, wants payment terms fixed → reply" — or just the event otherwise, ' +
      'e.g. "Hosting invoice paid (€12,40)". No explanation prose.',
  }),
  needsUser: Type.Optional(
    Type.Boolean({
      description:
        "True when the item waits on the user: a reply, a decision, an action, or a reply they " +
        "are still waiting for. The server carries such an item into later reports until the " +
        "user closes it or you report it resolved. Leave it off for informational rows.",
    }),
  ),
  deadline: Type.Optional(
    Type.String({
      description:
        'An unambiguous deadline in the user\'s timezone, e.g. "Fri 4 Sep, 17:00". Resolve ' +
        'relative wording against the run date; never store "tomorrow" or another phrase that ' +
        "will become false in a later report.",
    }),
  ),
  draftId: Type.Optional(
    Type.String({ description: "Set when this run saved a reply draft for the item." }),
  ),
  resolved: Type.Optional(
    Type.Boolean({
      description:
        "True when an item the run context lists as unresolved no longer needs the user: they " +
        "acted themselves, the deadline passed, or the matter closed. Say why in the gist. It " +
        "is shown struck through once, then retired.",
    }),
  ),
});

const sectionParam = Type.Object({
  label: Type.String({
    minLength: 1,
    description:
      'The heading, in the user\'s language, e.g. "Urgent", "Waiting for their reply", ' +
      '"Newsletters". Sections render in the order given; put what needs the user first.',
  }),
  collapsed: Type.Optional(
    Type.Boolean({
      description:
        "Fold the section by default: routine items (newsletters, receipts, notifications) " +
        "the user unfolds on demand.",
    }),
  ),
  items: Type.Array(itemParam, { description: "Every item in this section, one row each." }),
});

type RawItem = (typeof itemParam)["static"];

export function buildPublishReportTool(sessionId: string): AgentTool {
  return tool({
    name: "publish_report",
    label: "Publish the report",
    description:
      `Publish a structured, interactive report card: sections you name, one row per item, ` +
      `with per-row actions. Use it for every multi-item digest — an inbox sweep, a status ` +
      `roundup, a weekly review. Call it once at the end, after every item is triaged, so one ` +
      `successful call publishes one card. If publication is rejected, correct the reported ` +
      `inputs and retry; a rejected call publishes nothing. Finish drafting warranted replies ` +
      `before publishing. An email item needs only its threadId (as mail_search returned it) ` +
      `and a one-line gist; a web item a url and title; a plain item a title. Mark what waits ` +
      `on the user with needsUser: the server carries those items into later reports until ` +
      `the user closes them or you report them with resolved: true. The card IS the report: ` +
      `once you call this, don't re-list the items in prose in your final answer.`,
    params: {
      headline: Type.Optional(
        Type.String({
          description: 'One line on where the user stands, e.g. "Two things need you today".',
        }),
      ),
      periodLabel: Type.Optional(
        Type.String({
          description: 'The window reviewed, in plain words, e.g. "since yesterday morning".',
        }),
      ),
      scanned: Type.Optional(
        Type.Number({
          description:
            "Total messages reviewed; the server counts what the mail tools returned and uses " +
            "that when it is higher.",
        }),
      ),
      sections: Type.Array(sectionParam, {
        description: "The report's groups in reading order; the UI renders them as given.",
      }),
    },
    execute: async ({ headline, periodLabel, scanned, sections: rawSections }) => {
      const accounts = await listAccounts();
      const accountLookup = new Map<string, ConnectedAccount>(accounts.map((a) => [a.id, a]));
      const dropped: string[] = [];

      // Every email fact comes from what a mail tool returned in this session.
      // A mistyped or stale id prevents publication instead of producing an
      // authoritative-looking row with invented data.
      const resolveEmail = (raw: RawItem, threadId: string): ReportItem | undefined => {
        const named = raw.account ? findAccount(accounts, raw.account) : undefined;
        const seen = recallThread(sessionId, threadId, named?.id);
        if (!seen) {
          dropped.push(`thread ${threadId} was not returned by mail_search or mail_thread`);
          return undefined;
        }
        const account = named ?? accountLookup.get(seen.accountId);
        if (!account) {
          dropped.push(`thread ${threadId} belongs to an account that is no longer connected`);
          return undefined;
        }
        const sender = parseMailbox(seen.from);
        // A thread whose newest message is the user's own is about whoever they
        // wrote to, so the row names the recipient, not "me".
        const fromMe =
          !!sender?.address && sender.address.toLowerCase() === account.name.toLowerCase();
        const counterpart = (fromMe && parseMailbox(seen.to[0] ?? "")) || sender;
        const webUrl = threadWebUrl(account, threadId) || undefined;
        const ref: ReportRef = {
          kind: "email",
          accountId: account.id,
          threadId,
          ...(seen.messageId ? { messageId: seen.messageId } : {}),
          sender: counterpart?.name || counterpart?.address || seen.from || "(unknown sender)",
          ...(counterpart?.address ? { senderEmail: counterpart.address } : {}),
          ...(seen.date ? { receivedAt: seen.date } : {}),
          ...(webUrl ? { webUrl } : {}),
        };
        return coerceReportItem(
          { ...raw, title: seen.subject || "(no subject)", handled: raw.resolved === true },
          ref,
        );
      };

      const resolveItem = (raw: RawItem): ReportItem | undefined => {
        const threadId = raw.threadId?.trim();
        if (threadId) return resolveEmail(raw, threadId);
        const url = raw.url?.trim();
        const title = raw.title?.trim();
        if (!title) {
          dropped.push(`an item without threadId needs a title (gist "${raw.gist}")`);
          return undefined;
        }
        const ref: ReportRef = url ? { kind: "url", url } : { kind: "none" };
        return coerceReportItem({ ...raw, title, handled: raw.resolved === true }, ref);
      };

      const sections: ReportSection[] = [];
      for (const raw of rawSections) {
        const items: ReportItem[] = [];
        for (const rawItem of raw.items) {
          const item = resolveItem(rawItem);
          if (item) items.push(item);
        }
        const section = coerceReportSection(raw, items);
        if (section) sections.push(section);
      }

      if (dropped.length > 0) {
        return textResult(
          `Report not published: ${dropped.join("; ")}. Search those threads again, then ` +
            "call publish_report with the returned ids.",
        );
      }

      const allItems = sections.flatMap((s) => s.items);
      const seenAccountIds = new Set(
        allItems.flatMap((i) => (i.ref.kind === "email" ? [i.ref.accountId] : [])),
      );
      const cardAccounts: CardAccount[] = [...seenAccountIds]
        .map((id) => accountLookup.get(id))
        .filter((a): a is ConnectedAccount => a !== undefined)
        .map(toCardAccount);

      const card = await reconcileReportCard(
        sessionId,
        buildReportCard({
          headline: headline?.trim() || undefined,
          periodLabel: periodLabel?.trim() || undefined,
          accounts: cardAccounts,
          sections,
          scanned: Math.max(scanned ?? 0, seenMessageCount(sessionId)) || undefined,
        }),
      );

      const shown = card.sections.flatMap((s) => s.items);
      const open = shown.filter((i) => i.needsUser && !i.handled);
      const resolvedCount = shown.filter((i) => i.handled).length;
      const draftedCount = shown.filter((i) => i.draftId && !i.handled).length;
      const parts = [
        `Report published: ${shown.length} item${shown.length === 1 ? "" : "s"} in ` +
          `${card.sections.length} section${card.sections.length === 1 ? "" : "s"}`,
        open.length > 0 ? `${open.length} waiting on the user` : "nothing waiting on the user",
      ];
      if (resolvedCount > 0) parts.push(`${resolvedCount} resolved since the last report`);
      if (draftedCount > 0)
        parts.push(`${draftedCount} draft${draftedCount === 1 ? "" : "s"} linked`);
      return textResult(`${parts.join(", ")}.${REPORT_CARD_NOTE}`, card);
    },
  });
}
