import type { AgentCard, MessageCard, ReportItem, ReportSection } from "@marlen/shared";
import { and, desc, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { reportItemKey } from "../../agent/cards.js";
import { emitServerEvent } from "../../core/events.js";
import { db, schema } from "../../db/index.js";

type ReportCard = Extract<AgentCard, { kind: "report" }>;
type Disposition = "open" | "reported" | "handled";

/** What a repeat of the same item must differ in to count as news. */
function changeKey(item: ReportItem): string {
  return item.ref.kind === "email" ? (item.ref.messageId ?? "") : item.gist;
}

/** A JSON value written by this app is trusted at this boundary. */
function storedItem(value: string): ReportItem {
  return JSON.parse(value) as ReportItem;
}

/** Draft decisions made in Home are durable evidence that their thread no longer needs attention. */
async function syncDraftDecisions(automationId: string): Promise<void> {
  const [drafts, proposals] = await Promise.all([
    db
      .select({
        accountId: schema.agentDrafts.accountId,
        threadId: schema.agentDrafts.threadId,
        decidedAt: schema.agentDrafts.updatedAt,
      })
      .from(schema.agentDrafts)
      .where(
        and(
          inArray(schema.agentDrafts.status, ["sent", "discarded"]),
          isNotNull(schema.agentDrafts.threadId),
        ),
      ),
    db
      .select({
        accountId: schema.draftProposals.accountId,
        threadId: schema.draftProposals.threadId,
        decidedAt: schema.draftProposals.updatedAt,
      })
      .from(schema.draftProposals)
      .where(
        and(
          inArray(schema.draftProposals.status, ["sent", "discarded"]),
          isNotNull(schema.draftProposals.threadId),
        ),
      ),
  ]);

  const decided = new Map<string, string>();
  for (const row of [...drafts, ...proposals]) {
    if (!row.threadId) continue;
    const key = reportItemKey(
      { kind: "email", accountId: row.accountId, threadId: row.threadId, sender: "" },
      "",
    );
    const known = decided.get(key);
    if (known && known >= row.decidedAt) continue;
    decided.set(key, row.decidedAt);
  }
  if (decided.size === 0) return;

  const now = new Date().toISOString();
  db.transaction((tx) => {
    for (const [itemKey, decidedAt] of decided) {
      tx.update(schema.automationReportItems)
        .set({ disposition: "handled", handledAt: now, updatedAt: now })
        .where(
          and(
            eq(schema.automationReportItems.automationId, automationId),
            eq(schema.automationReportItems.itemKey, itemKey),
            // A later provider message reopens the item. An old draft
            // decision must never close that newer evidence on every run.
            lte(schema.automationReportItems.updatedAt, decidedAt),
          ),
        )
        .run();
    }
  });
}

function refFacts(item: ReportItem): string {
  switch (item.ref.kind) {
    case "email":
      return (
        `account ${item.ref.accountId}; thread ${item.ref.threadId}; ` +
        `message ${item.ref.messageId || "unknown"}`
      );
    case "url":
      return `url ${item.ref.url}`;
    case "none":
      return `title "${item.title}"`;
    default: {
      const _exhaustive: never = item.ref;
      return _exhaustive;
    }
  }
}

/** Compact durable facts included in the next run instead of an empty session. */
export async function automationReportContext(automationId: string): Promise<string> {
  await syncDraftDecisions(automationId);
  const rows = await db
    .select()
    .from(schema.automationReportItems)
    .where(
      and(
        eq(schema.automationReportItems.automationId, automationId),
        eq(schema.automationReportItems.disposition, "open"),
      ),
    )
    .orderBy(desc(schema.automationReportItems.updatedAt))
    .limit(50);
  if (rows.length === 0) return "";

  const lines = rows.map((row) => {
    const item = storedItem(row.itemJson);
    const since = (row.firstReportedAt || row.lastReportedAt).slice(0, 10);
    return (
      `- ${row.sectionLabel} · ${item.title} · ${item.gist} ` +
      `[${refFacts(item)}; open since ${since}]`
    );
  });
  return (
    "\n\nDurable unresolved work from earlier runs:\n" +
    `${lines.join("\n")}\n` +
    "The server carries these items into this run's report until the user marks them done, " +
    "sends or discards their linked draft, or you report them with resolved: true because they " +
    "no longer need the user (they acted themselves, the deadline passed, the matter closed). " +
    "Do not create a duplicate draft for them. Informational and handled items are remembered " +
    "separately and will not be shown again unless something about them changed."
  );
}

async function automationIdForRun(runId: string): Promise<string | undefined> {
  const [run] = await db
    .select({ automationId: schema.automationRuns.automationId })
    .from(schema.automationRuns)
    .where(eq(schema.automationRuns.id, runId))
    .limit(1);
  return run?.automationId;
}

interface StateWrite {
  item: ReportItem;
  sectionLabel: string;
  disposition: Disposition;
  firstReportedAt: string;
}

/**
 * Deduplicate unchanged informational rows, carry work that waits on the
 * user, mark what changed since the previous report, retire what the model
 * resolved, and persist exactly what the user will see. Chat reports have no
 * run row and pass through.
 */
export async function reconcileReportCard(runId: string, card: ReportCard): Promise<ReportCard> {
  const automationId = await automationIdForRun(runId);
  if (!automationId) return card;
  await syncDraftDecisions(automationId);

  const priorRows = await db
    .select()
    .from(schema.automationReportItems)
    .where(eq(schema.automationReportItems.automationId, automationId));
  const prior = new Map(priorRows.map((row) => [row.itemKey, row] as const));
  // Every row of one report shares its lastReportedAt, so the newest is the previous report.
  const previousReportAt = priorRows.reduce(
    (max, row) => (row.lastReportedAt > max ? row.lastReportedAt : max),
    "",
  );
  const now = new Date().toISOString();
  const writes: StateWrite[] = [];
  const surfaced = new Set<string>();

  // The item as the user will see it, or undefined for unchanged rows they already saw.
  const place = (item: ReportItem, section: ReportSection): ReportItem | undefined => {
    if (surfaced.has(item.key)) return undefined;
    surfaced.add(item.key);
    const known = prior.get(item.key);
    if (item.handled) {
      writes.push({
        item,
        sectionLabel: section.label,
        disposition: "handled",
        firstReportedAt: known?.firstReportedAt || now,
      });
      return item;
    }
    const changed = !known || known.changeKey !== changeKey(item);
    if (known && !changed && known.disposition !== "open") return undefined;
    const reopened = changed && known !== undefined && known.disposition !== "open";
    const firstReportedAt =
      !known || reopened ? now : known.firstReportedAt || known.lastReportedAt;
    // Folded sections hold routine rows; a "new" mark on each would be noise.
    const shown: ReportItem = section.collapsed
      ? item
      : {
          ...item,
          change: !known ? "new" : changed ? "updated" : "carried",
          since: firstReportedAt,
        };
    writes.push({
      item: shown,
      sectionLabel: section.label,
      disposition: shown.needsUser ? "open" : "reported",
      firstReportedAt,
    });
    return shown;
  };

  const sections: ReportSection[] = card.sections.map((section) => ({
    ...section,
    items: section.items
      .map((item) => place(item, section))
      .filter((item): item is ReportItem => item !== undefined),
  }));
  const sectionByLabel = new Map(sections.map((section) => [section.label, section]));
  const sectionFor = (label: string): ReportSection => {
    const existing = sectionByLabel.get(label);
    if (existing) return existing;
    const created: ReportSection = { label, items: [] };
    sections.push(created);
    sectionByLabel.set(label, created);
    return created;
  };

  // Open work is a state, not a property of today's search window. Carry it
  // server-side so a model omission cannot silently make a task disappear.
  // Work closed since the previous report appears struck through once, so
  // the user sees it leave.
  for (const row of priorRows) {
    if (surfaced.has(row.itemKey)) continue;
    if (row.disposition === "open") {
      const firstReportedAt = row.firstReportedAt || row.lastReportedAt;
      const item: ReportItem = {
        ...storedItem(row.itemJson),
        change: "carried",
        since: firstReportedAt,
      };
      sectionFor(row.sectionLabel).items.push(item);
      writes.push({ item, sectionLabel: row.sectionLabel, disposition: "open", firstReportedAt });
      surfaced.add(row.itemKey);
    } else if (row.disposition === "handled" && row.handledAt && row.handledAt > previousReportAt) {
      sectionFor(row.sectionLabel).items.push({ ...storedItem(row.itemJson), handled: true });
      surfaced.add(row.itemKey);
    }
  }

  const reconciled: ReportCard = {
    ...card,
    sections: sections.filter((section) => section.items.length > 0),
  };

  db.transaction((tx) => {
    for (const { item, sectionLabel, disposition, firstReportedAt } of writes) {
      // Marks are derived per report; the state keeps only the item itself.
      const itemJson = JSON.stringify({
        ...item,
        handled: undefined,
        change: undefined,
        since: undefined,
      });
      const values = {
        changeKey: changeKey(item),
        sectionLabel,
        itemJson,
        disposition,
        firstReportedAt,
        lastReportedAt: now,
        handledAt: disposition === "handled" ? now : null,
        updatedAt: now,
      };
      tx.insert(schema.automationReportItems)
        .values({ automationId, itemKey: item.key, ...values })
        .onConflictDoUpdate({
          target: [schema.automationReportItems.automationId, schema.automationReportItems.itemKey],
          set: values,
        })
        .run();
    }
  });
  return reconciled;
}

function markCardItemHandled(cardsJson: string | null, itemKey: string): string | null {
  if (!cardsJson) return null;
  const cards = JSON.parse(cardsJson) as MessageCard[];
  for (const entry of cards) {
    if (entry.card.kind !== "report") continue;
    for (const item of entry.card.sections.flatMap((section) => section.items)) {
      if (item.key === itemKey) item.handled = true;
    }
  }
  return JSON.stringify(cards);
}

/** Persist the explicit Home feedback and mark the historical card itself. */
export async function handleReportItem(runId: string, itemKey: string): Promise<boolean> {
  const [run] = await db
    .select({
      automationId: schema.automationRuns.automationId,
      cards: schema.automationRuns.cards,
    })
    .from(schema.automationRuns)
    .where(eq(schema.automationRuns.id, runId))
    .limit(1);
  if (!run) return false;

  const now = new Date().toISOString();
  const changed = await db
    .update(schema.automationReportItems)
    .set({ disposition: "handled", handledAt: now, updatedAt: now })
    .where(
      and(
        eq(schema.automationReportItems.automationId, run.automationId),
        eq(schema.automationReportItems.itemKey, itemKey),
      ),
    )
    .returning({ itemKey: schema.automationReportItems.itemKey });
  if (changed.length === 0) return false;

  await db
    .update(schema.automationRuns)
    .set({ cards: markCardItemHandled(run.cards, itemKey) })
    .where(eq(schema.automationRuns.id, runId));
  emitServerEvent("runs");
  return true;
}
