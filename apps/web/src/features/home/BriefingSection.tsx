import type { AccountColor, AgentCard, MessageCard, RunFeedItem } from "@marlen/shared";
import { RefreshCw } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { AgentCardView } from "@/components/cards";
import { ReportCard } from "@/components/cards/ReportCard";
import { OpenRunInChatButton } from "@/components/OpenRunInChatButton";
import { RunTriggerBadge } from "@/components/RunTriggerBadge";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { SectionTitle } from "@/components/ui/section-header";
import { NewDot, runSeenKey, type Seen, SeenOnInteract } from "@/features/home/seen";
import { api } from "@/lib/api";
import { dayTimeLabel } from "@/lib/dates";
import type { View } from "@/lib/nav";
import { toast } from "@/lib/toast";

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
 * The run Home opens with: the pinned automation's latest result when one is
 * pinned, else the newest run whose turn published a report. The feed arrives
 * newest first.
 */
export function pickReport(
  pinned: RunFeedItem | null | undefined,
  runs: RunFeedItem[] | null,
): RunFeedItem | null {
  if (pinned) return pinned;
  return (runs ?? []).find((run) => run.status === "success" && findReportCard(run)) ?? null;
}

/**
 * "Briefing": Marlene's latest report, whole on arrival. A quiet report (no
 * sections) folds to its headline so a calm morning costs one row. The work
 * log beside it never repeats this run.
 */
export function BriefingSection({
  run,
  runs,
  colors,
  onNavigate,
  seen,
}: {
  run: RunFeedItem;
  /** The full feed, read only to light the refresh button while a re-run is in flight. */
  runs: RunFeedItem[] | null;
  colors: AccountColor[];
  onNavigate: (view: View) => void;
  seen: Seen;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [starting, setStarting] = React.useState(false);

  const report = findReportCard(run);
  const quiet = !!report && report.sections.length === 0;
  const cards = homeCards(run);
  const running = (runs ?? []).some(
    (r) => r.automationId === run.automationId && r.status === "running",
  );

  const refresh = async () => {
    setStarting(true);
    try {
      await api.runAutomation(run.automationId);
    } catch (err) {
      toast.error(err);
    } finally {
      setStarting(false);
    }
  };

  return (
    <SeenOnInteract
      seen={seen}
      itemKey={runSeenKey(run.id)}
      createdAt={run.startedAt}
      className="flex flex-col gap-3"
    >
      {(isNew) => (
        <>
          <SectionTitle title={t("home.briefingTitle")}>
            {isNew && <NewDot />}
            <span className="mr-1 max-w-48 truncate text-xs text-muted-foreground">
              {run.automationName ?? t("home.deletedAutomation")} ·{" "}
              {dayTimeLabel(run.startedAt, lang, "long")}
            </span>
            <RunTriggerBadge trigger={run.trigger} />
            {run.automationName !== null && (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t("home.briefingRefresh")}
                data-tooltip={t("home.briefingRefresh")}
                loading={starting || running}
                onClick={() => void refresh()}
              >
                <RefreshCw />
              </Button>
            )}
            <OpenRunInChatButton
              conversationId={run.conversationId}
              onNavigateToChat={() => onNavigate("chat")}
            />
          </SectionTitle>

          <div className="surface animate-in-up flex flex-col gap-3 rounded-lg p-4">
            {quiet ? (
              <p className="text-sm text-muted-foreground">
                {report.headline ?? t("chat.cards.report.empty")}
              </p>
            ) : report ? (
              <ReportCard card={report} colors={colors} runId={run.id} bare />
            ) : (
              run.result && <Markdown content={run.result} className="text-sm text-foreground/90" />
            )}
          </div>

          {/* The run's other work products stand beside the panel, never inside it. */}
          {cards.map(({ toolCallId, card }) => (
            <AgentCardView key={toolCallId} card={card} colors={colors} />
          ))}
        </>
      )}
    </SeenOnInteract>
  );
}
