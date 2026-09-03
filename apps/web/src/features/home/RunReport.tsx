import type { AccountColor, RunFeedItem } from "@marlen/shared";
import { useTranslation } from "react-i18next";
import { AgentCardView } from "@/components/cards";
import { ReportCard } from "@/components/cards/ReportCard";
import { Markdown } from "@/components/ui/markdown";
import { findReportCard, homeCards } from "@/features/home/runs";

/**
 * What a run produced, read on Home: its report card when the turn published
 * one, else its result as prose, then its other work products. Bare on the
 * white page, so it reads the same in the pinned band and on the run's page.
 */
export function RunReport({ run, colors }: { run: RunFeedItem; colors: AccountColor[] }) {
  const { t } = useTranslation();
  const report = findReportCard(run);
  const quiet = !!report && report.sections.length === 0;

  return (
    <div className="flex flex-col gap-5">
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

      {homeCards(run).map(({ toolCallId, card }) => (
        <AgentCardView key={toolCallId} card={card} colors={colors} />
      ))}
    </div>
  );
}
