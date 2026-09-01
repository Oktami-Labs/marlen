import { createHash } from "node:crypto";
import type { BriefingPriority } from "@marlen/shared";
import { and, desc, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "../../db/index.js";
import { getLanguageSetting, getSetting, setSetting } from "../../db/settings.js";
import {
  readPage,
  updatePage,
  WikiPageConflictError,
  writeNamedPage,
} from "../../storage/wiki/store.js";

/**
 * Draft decisions are direct feedback about triage, separate from the edits
 * that teach writing style: keeping/sending says a proposed reply was useful;
 * discarding says it was not. The aggregate is intentionally conservative and
 * contains no sender-controlled text.
 */

const PAGE_ID = "triage-feedback";
const PAGE_HASH_SETTING = "learn.triageFeedbackPageHash";
const MAX_DECISIONS = 500;
const MIN_PATTERN_SAMPLES = 3;

type Decision = "accepted" | "discarded";

interface Outcome {
  priority: BriefingPriority;
  decision: Decision;
}

interface Counts {
  accepted: number;
  discarded: number;
}

interface Pattern {
  priority: BriefingPriority;
  tendency: Decision;
}

export interface TriageLearningResult {
  decisions: number;
  updated: boolean;
  /** An existing page was user-owned, edited, or deliberately removed. */
  protected: boolean;
}

function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function keyOf(accountId: string, threadId: string): string {
  return `${accountId}\n${threadId}`;
}

function addCount(counts: Counts, decision: Decision): void {
  counts[decision] += 1;
}

function renderFeedback(outcomes: Outcome[], language: "de" | "en"): string {
  const total: Counts = { accepted: 0, discarded: 0 };
  const byPriority = new Map<BriefingPriority, Counts>();
  for (const outcome of outcomes) {
    addCount(total, outcome.decision);
    const counts = byPriority.get(outcome.priority) ?? { accepted: 0, discarded: 0 };
    addCount(counts, outcome.decision);
    byPriority.set(outcome.priority, counts);
  }

  const priorities: BriefingPriority[] = ["urgent", "reply", "action", "fyi"];
  const patterns: Pattern[] = [];
  for (const priority of priorities) {
    const counts = byPriority.get(priority);
    if (!counts) continue;
    const samples = counts.accepted + counts.discarded;
    if (samples < MIN_PATTERN_SAMPLES) continue;
    const acceptance = counts.accepted / samples;
    if (acceptance >= 0.75) patterns.push({ priority, tendency: "accepted" });
    else if (acceptance <= 0.25) patterns.push({ priority, tendency: "discarded" });
  }

  if (language === "de") {
    const summary =
      `Beobachtetes Triage-Feedback aus ${outcomes.length} entschiedenen Antwortentwürfen: ` +
      `${total.accepted} wurden behalten oder gesendet, ${total.discarded} verworfen. ` +
      "Das sind Hinweise, keine festen Regeln; der Inhalt der aktuellen Mail entscheidet weiterhin, ob ein Entwurf sinnvoll ist.";
    const evidence = priorities.flatMap((priority) => {
      const counts = byPriority.get(priority);
      if (!counts) return [];
      return [`- ${priority}: ${counts.accepted} behalten/gesendet, ${counts.discarded} verworfen`];
    });
    const guidance = patterns.map(({ priority, tendency }) =>
      tendency === "accepted"
        ? `- Bei ${priority}-Mails waren proaktive Entwürfe meist nützlich.`
        : `- Bei ${priority}-Mails wurden proaktive Entwürfe meist verworfen; nur entwerfen, wenn eine reale Person klar eine Antwort erwartet.`,
    );
    return [
      summary,
      "",
      "Entscheidungen nach der damaligen Einstufung:",
      ...evidence,
      ...(guidance.length > 0
        ? ["", "Belastbare Muster (mindestens drei Beispiele):", ...guidance]
        : []),
      "",
      "Diese Seite wird aus Entwurfsentscheidungen erzeugt. Eigene Änderungen stoppen automatische Aktualisierungen.",
    ].join("\n");
  }

  const summary =
    `Observed triage feedback from ${outcomes.length} decided reply drafts: ` +
    `${total.accepted} were kept or sent and ${total.discarded} were discarded. ` +
    "Treat these as evidence, not fixed rules; the current message still decides whether a draft is useful.";
  const evidence = priorities.flatMap((priority) => {
    const counts = byPriority.get(priority);
    if (!counts) return [];
    return [`- ${priority}: ${counts.accepted} kept/sent, ${counts.discarded} discarded`];
  });
  const guidance = patterns.map(({ priority, tendency }) =>
    tendency === "accepted"
      ? `- Proactive drafts for ${priority} mail have usually been useful.`
      : `- Proactive drafts for ${priority} mail were usually discarded; draft only when a real person clearly expects a reply.`,
  );
  return [
    summary,
    "",
    "Decisions by the priority assigned at the time:",
    ...evidence,
    ...(guidance.length > 0
      ? ["", "Reliable patterns (at least three examples):", ...guidance]
      : []),
    "",
    "This page is generated from draft decisions. Editing it stops automatic updates.",
  ].join("\n");
}

/** Aggregate accepted/discarded briefing drafts into a pinned, auditable memory page. */
export async function runTriageLearning(): Promise<TriageLearningResult> {
  const [states, draftRows, proposalRows] = await Promise.all([
    db
      .select({
        accountId: schema.automationThreadStates.accountId,
        threadId: schema.automationThreadStates.threadId,
        itemJson: schema.automationThreadStates.itemJson,
        lastReportedAt: schema.automationThreadStates.lastReportedAt,
      })
      .from(schema.automationThreadStates)
      .orderBy(desc(schema.automationThreadStates.updatedAt))
      .limit(MAX_DECISIONS),
    db
      .select({
        accountId: schema.agentDrafts.accountId,
        threadId: schema.agentDrafts.threadId,
        status: schema.agentDrafts.status,
        updatedAt: schema.agentDrafts.updatedAt,
      })
      .from(schema.agentDrafts)
      .where(
        and(
          inArray(schema.agentDrafts.status, ["sent", "discarded"]),
          isNotNull(schema.agentDrafts.threadId),
        ),
      )
      .orderBy(desc(schema.agentDrafts.updatedAt))
      .limit(MAX_DECISIONS),
    db
      .select({
        accountId: schema.draftProposals.accountId,
        threadId: schema.draftProposals.threadId,
        status: schema.draftProposals.status,
        updatedAt: schema.draftProposals.updatedAt,
      })
      .from(schema.draftProposals)
      .where(
        and(
          inArray(schema.draftProposals.status, ["kept", "sent", "discarded"]),
          isNotNull(schema.draftProposals.threadId),
        ),
      )
      .orderBy(desc(schema.draftProposals.updatedAt))
      .limit(MAX_DECISIONS),
  ]);

  // One decision per thread. A kept proposal can later become a sent or
  // discarded mailbox draft; the newest state is the feedback that matters.
  const decisions = new Map<string, { decision: Decision; updatedAt: string }>();
  const candidates = [...draftRows, ...proposalRows].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  for (const row of candidates) {
    if (!row.threadId) continue;
    const key = keyOf(row.accountId, row.threadId);
    if (decisions.has(key)) continue;
    decisions.set(key, {
      decision: row.status === "discarded" ? "discarded" : "accepted",
      updatedAt: row.updatedAt,
    });
  }

  const latestState = new Map<string, (typeof states)[number]>();
  for (const state of states) {
    const key = keyOf(state.accountId, state.threadId);
    if (!latestState.has(key)) latestState.set(key, state);
  }
  const outcomes: Outcome[] = [];
  for (const [key, decision] of decisions) {
    const state = latestState.get(key);
    if (!state) continue;
    // A decision about an older draft is not feedback about a later message
    // that happened to reuse the same provider thread.
    if (decision.updatedAt < state.lastReportedAt) continue;
    const item = JSON.parse(state.itemJson) as { priority?: BriefingPriority };
    if (!item.priority) continue;
    outcomes.push({ priority: item.priority, decision: decision.decision });
  }
  if (outcomes.length === 0) return { decisions: 0, updated: false, protected: false };

  const [existing, storedHash, language] = await Promise.all([
    readPage(PAGE_ID),
    getSetting(PAGE_HASH_SETTING),
    getLanguageSetting(),
  ]);
  // A missing page with an old generated hash was deleted deliberately. An
  // existing page without our hash is user-owned. A hash mismatch is an edit.
  if (
    (!existing && storedHash !== undefined) ||
    (existing && (storedHash === undefined || contentHash(existing.content) !== storedHash))
  ) {
    return { decisions: outcomes.length, updated: false, protected: true };
  }

  const content = renderFeedback(outcomes, language ?? "de");
  if (existing?.content === content) {
    return { decisions: outcomes.length, updated: false, protected: false };
  }
  if (existing) {
    try {
      const updated = await updatePage(PAGE_ID, content, {}, { baseRevision: existing.revision });
      if (!updated) return { decisions: outcomes.length, updated: false, protected: true };
    } catch (error) {
      if (error instanceof WikiPageConflictError) {
        return { decisions: outcomes.length, updated: false, protected: true };
      }
      throw error;
    }
  } else {
    await writeNamedPage(PAGE_ID, content, "agent", { type: "triage", pinned: true });
  }
  await setSetting(PAGE_HASH_SETTING, contentHash(content));
  return { decisions: outcomes.length, updated: true, protected: false };
}
