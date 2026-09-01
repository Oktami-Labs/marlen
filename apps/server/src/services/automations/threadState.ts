import type { AgentCard, BriefingItem, MessageCard } from "@marlen/shared";
import { and, desc, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { emitServerEvent } from "../../core/events.js";
import { db, schema } from "../../db/index.js";

type BriefingCard = Extract<AgentCard, { kind: "briefing" }>;
type Disposition = "open" | "reported" | "handled";

function stateKey(accountId: string, threadId: string): string {
  return `${accountId}\n${threadId}`;
}

function dispositionFor(item: BriefingItem, rollup: boolean): Disposition {
  return rollup || item.priority === "fyi" ? "reported" : "open";
}

/** A JSON value written by this app is trusted at this boundary. */
function storedItem(value: string): BriefingItem {
  return JSON.parse(value) as BriefingItem;
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

  const decided = new Map<string, { accountId: string; threadId: string; decidedAt: string }>();
  for (const row of [...drafts, ...proposals]) {
    if (!row.threadId) continue;
    const key = stateKey(row.accountId, row.threadId);
    const known = decided.get(key);
    if (known && known.decidedAt >= row.decidedAt) continue;
    decided.set(key, {
      accountId: row.accountId,
      threadId: row.threadId,
      decidedAt: row.decidedAt,
    });
  }
  if (decided.size === 0) return;

  const now = new Date().toISOString();
  db.transaction((tx) => {
    for (const { accountId, threadId, decidedAt } of decided.values()) {
      tx.update(schema.automationThreadStates)
        .set({ disposition: "handled", handledAt: now, updatedAt: now })
        .where(
          and(
            eq(schema.automationThreadStates.automationId, automationId),
            eq(schema.automationThreadStates.accountId, accountId),
            eq(schema.automationThreadStates.threadId, threadId),
            // A later provider message reopens the thread. An old draft
            // decision must never close that newer evidence on every run.
            lte(schema.automationThreadStates.updatedAt, decidedAt),
          ),
        )
        .run();
    }
  });
}

/** Compact durable facts included in the next run instead of an empty session. */
export async function automationThreadContext(automationId: string): Promise<string> {
  await syncDraftDecisions(automationId);
  const rows = await db
    .select()
    .from(schema.automationThreadStates)
    .where(
      and(
        eq(schema.automationThreadStates.automationId, automationId),
        eq(schema.automationThreadStates.disposition, "open"),
      ),
    )
    .orderBy(desc(schema.automationThreadStates.updatedAt))
    .limit(50);
  if (rows.length === 0) return "";

  const lines = rows.map((row) => {
    const item = storedItem(row.itemJson);
    return (
      `- ${item.priority} · ${item.subject} · ${item.gist} ` +
      `[account ${row.accountId}; thread ${row.threadId}; message ${row.messageId || "unknown"}]`
    );
  });
  return (
    "\n\nDurable unresolved work from earlier runs:\n" +
    `${lines.join("\n")}\n` +
    "The server carries these items into this run's briefing until the user marks them done, " +
    "sends their linked draft, or discards it. Do not create a duplicate draft for them. " +
    "Informational and handled messages are remembered separately and will not be shown again " +
    "unless the provider returns a newer message in the thread."
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

/**
 * Deduplicate unchanged FYI/handled rows, carry unresolved work, then persist
 * exactly what the user will see. Chat briefings have no run row and pass through.
 */
export async function reconcileBriefingCard(
  runId: string,
  card: BriefingCard,
): Promise<BriefingCard> {
  const automationId = await automationIdForRun(runId);
  if (!automationId) return card;
  await syncDraftDecisions(automationId);

  const priorRows = await db
    .select()
    .from(schema.automationThreadStates)
    .where(eq(schema.automationThreadStates.automationId, automationId));
  const prior = new Map(
    priorRows.map((row) => [stateKey(row.accountId, row.threadId), row] as const),
  );

  const includeCurrent = (item: BriefingItem): boolean => {
    if (!item.accountId) return true;
    const known = prior.get(stateKey(item.accountId, item.threadId));
    if (!known || known.messageId !== (item.messageId ?? "")) return true;
    return known.disposition === "open";
  };

  const items = card.items.filter(includeCurrent);
  const rollups = (card.rollups ?? [])
    .map((rollup) => ({ ...rollup, items: rollup.items.filter(includeCurrent) }))
    .filter((rollup) => rollup.items.length > 0);
  const surfaced = new Set(
    [...items, ...rollups.flatMap((rollup) => rollup.items)]
      .filter((item): item is BriefingItem & { accountId: string } => Boolean(item.accountId))
      .map((item) => stateKey(item.accountId, item.threadId)),
  );

  // Open work is a state, not a property of today's search window. Carry it
  // server-side so a model omission cannot silently make a task disappear.
  for (const row of priorRows) {
    const key = stateKey(row.accountId, row.threadId);
    if (row.disposition !== "open" || surfaced.has(key)) continue;
    items.push(storedItem(row.itemJson));
    surfaced.add(key);
  }

  const { rollups: _oldRollups, ...cardWithoutRollups } = card;
  const reconciled: BriefingCard = {
    ...cardWithoutRollups,
    items,
    ...(rollups.length > 0 ? { rollups } : {}),
  };
  const now = new Date().toISOString();
  const rowsToStore = [
    ...items.map((item) => ({ item, rollup: false })),
    ...rollups.flatMap((rollup) => rollup.items.map((item) => ({ item, rollup: true }))),
  ].filter((entry): entry is { item: BriefingItem & { accountId: string }; rollup: boolean } =>
    Boolean(entry.item.accountId),
  );

  db.transaction((tx) => {
    for (const { item, rollup } of rowsToStore) {
      const disposition = dispositionFor(item, rollup);
      tx.insert(schema.automationThreadStates)
        .values({
          automationId,
          accountId: item.accountId,
          threadId: item.threadId,
          messageId: item.messageId ?? "",
          itemJson: JSON.stringify({ ...item, handled: undefined }),
          disposition,
          lastReportedAt: now,
          handledAt: null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            schema.automationThreadStates.automationId,
            schema.automationThreadStates.accountId,
            schema.automationThreadStates.threadId,
          ],
          set: {
            messageId: item.messageId ?? "",
            itemJson: JSON.stringify({ ...item, handled: undefined }),
            disposition,
            lastReportedAt: now,
            handledAt: null,
            updatedAt: now,
          },
        })
        .run();
    }
  });
  return reconciled;
}

function markCardItemHandled(
  cardsJson: string | null,
  accountId: string,
  threadId: string,
): string | null {
  if (!cardsJson) return null;
  const cards = JSON.parse(cardsJson) as MessageCard[];
  for (const entry of cards) {
    if (entry.card.kind !== "briefing") continue;
    for (const item of [
      ...entry.card.items,
      ...(entry.card.rollups ?? []).flatMap((rollup) => rollup.items),
    ]) {
      if (item.accountId === accountId && item.threadId === threadId) item.handled = true;
    }
  }
  return JSON.stringify(cards);
}

/** Persist the explicit Home feedback and mark the historical card itself. */
export async function handleBriefingItem(
  runId: string,
  accountId: string,
  threadId: string,
): Promise<boolean> {
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
    .update(schema.automationThreadStates)
    .set({ disposition: "handled", handledAt: now, updatedAt: now })
    .where(
      and(
        eq(schema.automationThreadStates.automationId, run.automationId),
        eq(schema.automationThreadStates.accountId, accountId),
        eq(schema.automationThreadStates.threadId, threadId),
      ),
    )
    .returning({ threadId: schema.automationThreadStates.threadId });
  if (changed.length === 0) return false;

  await db
    .update(schema.automationRuns)
    .set({ cards: markCardItemHandled(run.cards, accountId, threadId) })
    .where(eq(schema.automationRuns.id, runId));
  emitServerEvent("runs");
  return true;
}
