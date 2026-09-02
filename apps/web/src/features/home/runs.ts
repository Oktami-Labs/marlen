import type { AgentCard, MessageCard, RunFeedItem } from "@marlen/shared";
import { runSeenKey, type Seen } from "@/features/home/seen";

type ReportCardData = Extract<AgentCard, { kind: "report" }>;

/** Work products read on Home; evidence cards (sources, search hits, delegation lanes) and drafts stay in the chat. */
const HOME_CARD_KINDS = new Set<AgentCard["kind"]>(["chart", "lead", "attachments"]);

export function homeCards(run: RunFeedItem): MessageCard[] {
  return (run.cards ?? []).filter(({ card }) => HOME_CARD_KINDS.has(card.kind));
}

/** The run's structured report card, when its turn published one. */
export function findReportCard(run: RunFeedItem): ReportCardData | undefined {
  const match = run.cards?.find((c) => c.card.kind === "report");
  return match ? (match.card as ReportCardData) : undefined;
}

/**
 * The run the day leads with: the pinned automation's latest result when one
 * is pinned, else the newest run whose turn published a report. The feed
 * arrives newest first.
 */
export function pickReport(
  pinned: RunFeedItem | null | undefined,
  runs: RunFeedItem[] | null,
): RunFeedItem | null {
  if (pinned) return pinned;
  return (runs ?? []).find((run) => run.status === "success" && findReportCard(run)) ?? null;
}

/** The run's one-line gist: the report's own headline, else the result's first
 *  line, minus the colon a line like "Run finished:" ends on. */
export function runSummary(run: RunFeedItem): string {
  const headline = findReportCard(run)?.headline;
  if (headline) return headline;
  const first = run.result
    .split("\n")
    .map((line) => line.replace(/^[#>*\-\s]+/, "").trim())
    .find(Boolean);
  return (first ?? "").replace(/[:;,]$/, "");
}

/** A run that found nothing to show, no report item and no card: the day list mutes it. */
export function routineRun(run: RunFeedItem): boolean {
  if (run.status !== "success") return false;
  const report = findReportCard(run);
  if (report) return report.sections.every((section) => section.items.length === 0);
  return (run.cards ?? []).length === 0;
}

/** Runs that finished since the user last looked; Home counts these as new. */
export function freshRuns(runs: RunFeedItem[] | null, seen: Seen): RunFeedItem[] {
  return (runs ?? []).filter(
    (run) => run.status !== "running" && seen.isNew(runSeenKey(run.id), run.startedAt),
  );
}
