import type { AccountColor, RunFeedItem } from "@marlen/shared";
import { ChevronLeft, RefreshCw } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { AgentCardView } from "@/components/cards";
import { ReportCard } from "@/components/cards/ReportCard";
import { OpenRunInChatButton } from "@/components/OpenRunInChatButton";
import { RunTriggerBadge } from "@/components/RunTriggerBadge";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { findReportCard, homeCards } from "@/features/home/runs";
import { api } from "@/lib/api";
import { dayTimeLabel } from "@/lib/dates";
import type { View } from "@/lib/nav";
import { toast } from "@/lib/toast";

/**
 * One run read in place of Home while `?report=<runId>` is set: its report
 * card when the turn published one, else its result, then its other work
 * products. Bare on the white page; the back link is the way home.
 */
export function ReportPage({
  run,
  runs,
  colors,
  onNavigate,
  onClose,
}: {
  run: RunFeedItem;
  /** The full feed, read only to light the refresh button while a re-run is in flight. */
  runs: RunFeedItem[] | null;
  colors: AccountColor[];
  onNavigate: (view: View) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
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
    <div className="flex flex-col gap-5 pt-1">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          <ChevronLeft />
          {t("views.home.title")}
        </Button>
        <span aria-hidden className="text-muted-foreground/50">
          /
        </span>
        <h2 className="min-w-0 truncate text-sm font-semibold tracking-tight">
          {run.automationName ?? t("home.deletedAutomation")}
        </h2>
        <div className="flex-1" />
        <span className="hidden truncate text-xs text-muted-foreground sm:inline">
          {dayTimeLabel(run.startedAt, i18n.language, "long")}
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
      </div>

      <div className="flex flex-col gap-3 px-3">
        {quiet ? (
          <p className="text-sm text-muted-foreground">
            {report.headline ?? t("chat.cards.report.empty")}
          </p>
        ) : report ? (
          <ReportCard card={report} colors={colors} runId={run.id} bare />
        ) : run.result ? (
          <Markdown content={run.result} className="text-sm text-foreground/90" />
        ) : (
          run.status === "error" && (
            <p className="text-sm text-muted-foreground">{t("home.workFailed")}</p>
          )
        )}
      </div>

      {cards.map(({ toolCallId, card }) => (
        <AgentCardView key={toolCallId} card={card} colors={colors} />
      ))}
    </div>
  );
}
