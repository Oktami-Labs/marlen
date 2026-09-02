import type { RunFeedItem } from "@marlen/shared";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { OpenRunInChatButton } from "@/components/OpenRunInChatButton";
import { ShowMoreButton } from "@/components/ui/disclosure-toggle";
import { LoadingRow, RetryableError } from "@/components/ui/feedback";
import { GroupLabel } from "@/components/ui/group-label";
import { HoverActions } from "@/components/ui/hover-actions";
import { Markdown } from "@/components/ui/markdown";
import { runIcon } from "@/features/home/DaySection";
import { routineRun, runSummary } from "@/features/home/runs";
import { dayTimeLabel } from "@/lib/dates";
import { usePagedVisible } from "@/lib/usePagedVisible";
import { cn, errorMessage, stagger, withViewTransition } from "@/lib/utils";

/**
 * The automation's run history in Home's day-row grammar: the clock in a mono
 * gutter, the glyph for what led to the run or that it failed, its gist. A
 * row unfolds the run's full result; a routine run, one that found nothing,
 * is muted.
 */
export function AutomationRuns({
  runs,
  error,
  onRetry,
  onOpenChat,
}: {
  /** Newest first; null while the first fetch is in flight. */
  runs: RunFeedItem[] | null;
  error: Error | null;
  onRetry: () => void;
  /** Route change once a run's conversation is targeted in the chat. */
  onOpenChat: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { visible, showMore } = usePagedVisible(6, 12, "");

  const body = () => {
    if (runs === null) {
      return error ? (
        <RetryableError onRetry={onRetry}>{errorMessage(error)}</RetryableError>
      ) : (
        <LoadingRow />
      );
    }
    if (runs.length === 0) {
      return <p className="py-1.5 text-xs text-muted-foreground">{t("automations.noRuns")}</p>;
    }
    return (
      <>
        {runs.slice(0, visible).map((run, index) => (
          <RunRow
            key={run.id}
            run={run}
            lang={i18n.language}
            style={stagger(index)}
            onOpenChat={onOpenChat}
          />
        ))}
        {runs.length > visible && (
          <div className="pt-1">
            <ShowMoreButton count={runs.length - visible} onClick={showMore} />
          </div>
        )}
      </>
    );
  };

  return (
    <section className="flex flex-col gap-1">
      <GroupLabel count={runs?.length} className="pb-1">
        {t("automations.runs")}
      </GroupLabel>
      {body()}
    </section>
  );
}

function RunRow({
  run,
  lang,
  style,
  onOpenChat,
}: {
  run: RunFeedItem;
  lang: string;
  style: React.CSSProperties;
  onOpenChat: () => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = React.useState(false);
  const muted = routineRun(run);
  const step = run.steps?.find((s) => !s.endedAt);
  const running = run.status === "running";
  const title = running ? (
    <span className="text-shimmer">
      {step?.label ?? (run.steps?.length ? "" : t("home.workStarting"))}
    </span>
  ) : (
    runSummary(run) || t(`automations.runStatus.${run.status}`)
  );
  const expandable = !running && run.result.trim() !== "";
  const toggle = () => withViewTransition(() => setExpanded((v) => !v));

  return (
    <div className="animate-in-up flex flex-col" style={style}>
      <div className="group flex items-center gap-1 rounded-lg pr-1 transition-colors has-[:focus-visible]:bg-surface-2 hover:bg-surface-2">
        <button
          type="button"
          onClick={expandable ? toggle : undefined}
          aria-expanded={expandable ? expanded : undefined}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-left",
            !expandable && "cursor-default",
          )}
        >
          <time
            dateTime={run.startedAt}
            className="w-[72px] shrink-0 whitespace-nowrap text-right font-mono text-2xs tabular-nums text-muted-foreground"
          >
            {dayTimeLabel(run.startedAt, lang)}
          </time>
          <span
            className={cn(
              "flex w-[18px] shrink-0 justify-center [&_svg]:size-[15px]",
              muted ? "text-muted-foreground/70" : "text-muted-foreground",
            )}
          >
            {runIcon(run, false)}
          </span>
          <span
            className={cn(
              "min-w-0 flex-1 text-sm font-medium",
              expanded ? "whitespace-normal" : "truncate",
              muted ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {title}
          </span>
        </button>
        <HoverActions>
          <OpenRunInChatButton conversationId={run.conversationId} onNavigateToChat={onOpenChat} />
        </HoverActions>
      </div>
      {expanded && expandable && (
        <Markdown content={run.result} className="px-2 pb-2 pl-[calc(72px+1.25rem+18px)] text-xs" />
      )}
    </div>
  );
}
