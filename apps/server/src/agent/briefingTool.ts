import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { BriefingItem, BriefingRollup, CardAccount, ConnectedAccount } from "@marlen/shared";
import { Type } from "@sinclair/typebox";
import { recallThread } from "../email/read/seenMail.js";
import { parseMailbox } from "../email/textUtils.js";
import { threadWebUrl } from "../email/webLinks.js";
import { listAccounts } from "../integrations/pipedream/connect.js";
import { reconcileBriefingCard } from "../services/automations/threadState.js";
import { findAccount } from "./accounts.js";
import {
  buildBriefingCard,
  cardNote,
  coerceBriefingItem,
  coerceBriefingRollup,
  toCardAccount,
} from "./cards.js";
import { textResult, tool } from "./toolkit.js";

const BRIEFING_CARD_NOTE = cardNote(
  "this briefing",
  "Do not repeat the items in prose — close with exactly one line naming what needs them " +
    'first, or "Quiet otherwise — nothing urgent" if nothing does.',
);

const PRIORITY_DESCRIPTION =
  '"urgent" when it is time-sensitive, a deadline could pass, or the user is blocked on it. ' +
  '"reply" when a real person is waiting on a reply but nothing is on fire. "action" when it ' +
  'needs a decision or task from the user and nobody is waiting. "fyi" when it is worth ' +
  "knowing and needs nothing.";

const priorityParam = Type.Union(
  [Type.Literal("urgent"), Type.Literal("reply"), Type.Literal("action"), Type.Literal("fyi")],
  { description: PRIORITY_DESCRIPTION },
);

/** The model supplies judgment; provider facts are resolved from the session's mail reads. */
const briefingItemParam = Type.Object({
  threadId: Type.String({
    minLength: 1,
    description:
      "The thread id exactly as mail_search or mail_thread returned it. Account, sender, " +
      "subject, message id, time and link are resolved from that result.",
  }),
  account: Type.Optional(
    Type.String({
      description:
        "The account email or id, needed only when the same thread id appeared in more than " +
        "one account.",
    }),
  ),
  gist: Type.String({
    minLength: 1,
    description:
      'One line, never a sentence: "topic: key fact → action" when it needs the ' +
      'user (urgent/reply/action) — e.g. "contract: signs Fri, wants payment terms ' +
      'fixed → reply" — or just "event" for fyi — e.g. "Hosting invoice paid ' +
      '(€12,40)". State the fact and the action tersely; no explanation prose (never ' +
      '"Anna replied regarding the contract, mentioning that she plans to sign on ' +
      'Friday but wants the payment terms adjusted first").',
  }),
  priority: priorityParam,
  deadline: Type.Optional(
    Type.String({
      description: 'When it must be answered by, in the sender\'s own terms, e.g. "Friday 17:00".',
    }),
  ),
  draftId: Type.Optional(
    Type.String({ description: "Set when this run saved a reply draft for the thread." }),
  ),
  carryover: Type.Optional(
    Type.Boolean({
      description:
        "True only when run context names this unchanged thread as still unresolved and it " +
        "must remain in today's briefing.",
    }),
  ),
});

export function buildComposeBriefingTool(sessionId: string): AgentTool {
  return tool({
    name: "compose_briefing",
    label: "Compose the briefing",
    description:
      `Publish a structured, interactive briefing card for a multi-message inbox digest — ` +
      `grouped by how urgently each message needs the user, with per-thread actions. Call this ` +
      `once, at the end, after triaging every noteworthy message across the accounts reviewed ` +
      `and drafting the replies that are warranted. An item needs only its threadId (as ` +
      `mail_search returned it), priority and a one-line gist, plus deadline and draftId where ` +
      `they apply; sender, subject and time are filled in from that search result. The card IS ` +
      `the report: once you call this, don't re-list the items in prose in your final answer.`,
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
        Type.Number({ description: "Total messages reviewed, including the ones rolled up." }),
      ),
      items: Type.Array(briefingItemParam, {
        description: "Every noteworthy message, flat across accounts — the UI groups by priority.",
      }),
      rollups: Type.Optional(
        Type.Array(
          Type.Object({
            label: Type.String({
              minLength: 1,
              description:
                'The kind of mail in this group, e.g. "Newsletters", "Receipts", ' +
                '"Promotions", "Notifications".',
            }),
            items: Type.Array(briefingItemParam, {
              description:
                "Every message in this group, listed individually — same shape as a tier item " +
                "(threadId, one-line gist), so each renders as its own actionable row under the " +
                "group heading. Draw the gist from the mail_search row; don't full-read these " +
                "just to roll them up.",
            }),
          }),
          {
            description:
              "Low-value mail (newsletters, receipts, shipping updates, notifications) grouped by " +
              "kind but still listed message by message, not collapsed to a count.",
          },
        ),
      ),
    },
    execute: async ({
      headline,
      periodLabel,
      scanned,
      items: rawItems,
      rollups: rawRollups = [],
    }) => {
      const accounts = await listAccounts();
      const accountLookup = new Map<string, ConnectedAccount>(accounts.map((a) => [a.id, a]));
      const dropped: string[] = [];

      // The account and every mail fact come from what a mail tool returned in
      // this session. A mistyped or stale id prevents publication instead of
      // producing an authoritative-looking row with invented data.
      const resolveItem = (raw: (typeof rawItems)[number]): BriefingItem | undefined => {
        const threadId = raw.threadId.trim();
        const named = raw.account ? findAccount(accounts, raw.account) : undefined;
        const seen = recallThread(sessionId, threadId, named?.id);
        if (!seen) {
          dropped.push(`thread ${threadId} was not returned by mail_search or mail_thread`);
          return undefined;
        }
        const account = named ?? (seen ? accountLookup.get(seen.accountId) : undefined);
        const sender = parseMailbox(seen.from);
        const merged = {
          ...raw,
          sender: sender?.name || sender?.address || seen.from || "(unknown sender)",
          senderEmail: sender?.address || undefined,
          subject: seen.subject || "(no subject)",
          receivedAt: seen.date,
          messageId: seen.messageId,
        };
        const webUrl = account ? threadWebUrl(account, threadId) || undefined : undefined;
        const item = coerceBriefingItem(merged, account?.id, webUrl);
        if (!item) dropped.push(`thread ${threadId} has no usable gist`);
        return item;
      };

      const items: BriefingItem[] = [];
      for (const raw of rawItems) {
        const item = resolveItem(raw);
        if (item) items.push(item);
      }

      const rollups: BriefingRollup[] = [];
      for (const raw of rawRollups) {
        const rollupItems: BriefingItem[] = [];
        for (const rawItem of raw.items) {
          const item = resolveItem(rawItem);
          if (item) rollupItems.push(item);
        }
        const rollup = coerceBriefingRollup(raw, rollupItems);
        if (rollup) rollups.push(rollup);
      }

      if (dropped.length > 0) {
        return textResult(
          `Briefing not published: ${dropped.join("; ")}. Search those threads again, then ` +
            "call compose_briefing with the returned ids.",
        );
      }

      const allItems = [...items, ...rollups.flatMap((r) => r.items)];
      const seenAccountIds = new Set(allItems.flatMap((i) => (i.accountId ? [i.accountId] : [])));
      const cardAccounts: CardAccount[] = [...seenAccountIds]
        .map((id) => accountLookup.get(id))
        .filter((a): a is ConnectedAccount => a !== undefined)
        .map(toCardAccount);

      const card = await reconcileBriefingCard(
        sessionId,
        buildBriefingCard({
          headline: headline?.trim() || undefined,
          periodLabel: periodLabel?.trim() || undefined,
          accounts: cardAccounts,
          items,
          rollups,
          scanned,
        }),
      );

      const urgentCount = card.items.filter((i) => i.priority === "urgent").length;
      const awaitingReplyCount = card.items.filter((i) => i.priority === "reply").length;
      const rolledUpCount = (card.rollups ?? []).reduce((sum, r) => sum + r.items.length, 0);
      const draftedCount = card.items.filter((i) => i.draftId).length;

      const summaryParts: string[] = [];
      if (card.items.length === 0) {
        summaryParts.push("Briefing published: no noteworthy items");
      } else {
        const tally = [
          urgentCount > 0 ? `${urgentCount} urgent` : undefined,
          awaitingReplyCount > 0 ? `${awaitingReplyCount} awaiting reply` : undefined,
        ].filter((s): s is string => Boolean(s));
        summaryParts.push(
          `Briefing published: ${card.items.length} item${card.items.length === 1 ? "" : "s"}` +
            (tally.length > 0 ? ` (${tally.join(", ")})` : ""),
        );
      }
      if (rolledUpCount > 0)
        summaryParts.push(`${rolledUpCount} message${rolledUpCount === 1 ? "" : "s"} rolled up`);
      if (draftedCount > 0)
        summaryParts.push(`${draftedCount} draft${draftedCount === 1 ? "" : "s"} linked`);

      return textResult(`${summaryParts.join(", ")}.${BRIEFING_CARD_NOTE}`, card);
    },
  });
}
