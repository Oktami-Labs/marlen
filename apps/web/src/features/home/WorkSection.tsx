import type { AccountColor, AgentCard, Automation, RunFeedItem, RunStep } from "@marlen/shared";
import {
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Clock,
  Newspaper,
  RefreshCw,
} from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { AgentCardView } from "@/components/cards";
import { BriefingCard } from "@/components/cards/BriefingCard";
import { OpenRunInChatButton } from "@/components/OpenRunInChatButton";
import { RunTriggerBadge } from "@/components/RunTriggerBadge";
import { Button } from "@/components/ui/button";
import { DisclosureToggle } from "@/components/ui/disclosure-toggle";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingRow } from "@/components/ui/feedback";
import { GroupLabel } from "@/components/ui/group-label";
import { Markdown } from "@/components/ui/markdown";
import { SectionTitle } from "@/components/ui/section-header";
import { upcomingRuns } from "@/features/home/agenda";
import { NewDot, runSeenKey, type Seen } from "@/features/home/seen";
import { api } from "@/lib/api";
import { dayLabel, isToday, timeLabel } from "@/lib/dates";
import type { View } from "@/lib/nav";
import { toast } from "@/lib/toast";
import { cn, stagger, toggleRowProps } from "@/lib/utils";

type BriefingCardData = Extract<AgentCard, { kind: "briefing" }>;

/** The run's structured briefing card, when its turn composed one. */
export function findBriefingCard(run: RunFeedItem): BriefingCardData | undefined {
  const match = run.cards?.find((c) => c.card.kind === "briefing");
  return match ? (match.card as BriefingCardData) : undefined;
}

/** Runs that finished since the user last looked; Home counts these as new. */
export function freshRuns(runs: RunFeedItem[] | null, seen: Seen): RunFeedItem[] {
  return (runs ?? []).filter(
    (run) => run.status !== "running" && seen.isNew(runSeenKey(run.id), run.startedAt),
  );
}

/** The run's one-line gist: the briefing's own headline, else the result's first
 *  line, minus the colon a line like "Run finished:" ends on. */
export function runSummary(run: RunFeedItem): string {
  const headline = findBriefingCard(run)?.headline;
  if (headline) return headline;
  const first = run.result
    .split("\n")
    .map((line) => line.replace(/^[#>*\-\s]+/, "").trim())
    .find(Boolean);
  return (first ?? "").replace(/[:;,]$/, "");
}

/**
 * "Marlene arbeitet": everything the agent does without the user, on one spine
 * that reads like the day: today's finished runs in the order they happened,
 * the run in flight with its live tool trail, then what is scheduled next. A
 * row unfolds into the run's own output (its briefing card, else the result
 * and cards), which is why this section replaces the separate briefing hero,
 * results, and activity log. The status line carries the counts; this header
 * repeats none of them.
 */
export function WorkSection({
  runs,
  automations,
  colors,
  onNavigate,
  seen,
  openRunId,
  focusRunId,
  onToggleRun,
}: {
  /** Null while the first fetch is in flight. */
  runs: RunFeedItem[] | null;
  automations: Automation[] | null;
  colors: AccountColor[];
  onNavigate: (view: View) => void;
  seen: Seen;
  /** The one unfolded row; Home owns it so the status line can open the briefing. */
  openRunId: string | null;
  /** The row the status line just opened: it scrolls into view and flashes once. */
  focusRunId: string | null;
  onToggleRun: (runId: string | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [showEarlier, setShowEarlier] = React.useState(false);
  // A briefing from an earlier day lives behind the disclosure; opening it
  // from the status line has to unfold that first or the row stays hidden.
  const focusEarlier = (runs ?? []).some((run) => run.id === focusRunId && !isToday(run.startedAt));
  React.useEffect(() => {
    if (focusEarlier) setShowEarlier(true);
  }, [focusEarlier]);

  const running = (runs ?? []).filter((run) => run.status === "running");
  const finished = (runs ?? []).filter((run) => run.status !== "running");
  // The feed arrives newest first; the spine reads top-down through the day.
  const todayRuns = finished
    .filter((run) => isToday(run.startedAt))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const earlierRuns = finished.filter((run) => !isToday(run.startedAt));

  // Beyond the horizon a schedule is the Automations page's business, not today's.
  const upcoming = upcomingRuns(automations);

  const count = running.length + upcoming.length + todayRuns.length;
  const hasAutomations = (automations?.length ?? 0) > 0;

  if (runs === null) {
    return (
      <section className="flex flex-col gap-3">
        <Head />
        <LoadingRow />
      </section>
    );
  }

  if (count === 0 && earlierRuns.length === 0) {
    return (
      <section className="flex flex-col gap-3">
        <Head />
        <EmptyState
          icon={Newspaper}
          title={t("home.activityEmptyTitle")}
          description={hasAutomations ? t("home.activityNoRunsBody") : t("home.activityEmptyBody")}
          action={
            <Button size="sm" onClick={() => onNavigate("automations")}>
              <CalendarClock />
              {hasAutomations ? t("home.viewAutomations") : t("home.createAutomation")}
            </Button>
          }
        />
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <Head />

      {/* One raised panel holding plain rows: never a card per run (DESIGN.md). */}
      <div className="surface flex flex-col gap-0.5 rounded-lg p-1.5">
        {todayRuns.map((run, i) => (
          <FinishedRow
            key={run.id}
            run={run}
            index={i}
            lang={lang}
            colors={colors}
            seen={seen}
            open={openRunId === run.id}
            focus={focusRunId === run.id}
            onToggle={() => onToggleRun(openRunId === run.id ? null : run.id)}
            onNavigate={onNavigate}
          />
        ))}
        {running.map((run, i) => (
          <RunningRow key={run.id} run={run} index={todayRuns.length + i} />
        ))}
        {/* The past/future seam needs naming only once there is a past above it. */}
        {upcoming.length > 0 && todayRuns.length + running.length > 0 && (
          <GroupLabel as="p" size="sm" className="px-2.5 pb-1 pt-3">
            {t("home.workUpNext")}
          </GroupLabel>
        )}
        {upcoming.map(({ automation, at }) => (
          <ScheduledRow key={automation.id} automation={automation} at={at} lang={lang} />
        ))}
        {count === 0 && (
          <p className="px-2.5 py-2 text-xs text-muted-foreground">
            {t("home.activityNothingToday")}
          </p>
        )}
      </div>

      {earlierRuns.length > 0 && (
        <div className="flex flex-col gap-3">
          {showEarlier && (
            <div className="flex flex-col gap-4">
              {[...groupByDay(earlierRuns, lang)].map(([day, dayRuns]) => (
                <div key={day} className="flex flex-col gap-1.5">
                  <p className="px-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                    {day}
                  </p>
                  <div className="surface flex flex-col gap-0.5 rounded-lg p-1.5">
                    {dayRuns.map((run, i) => (
                      <FinishedRow
                        key={run.id}
                        run={run}
                        index={i}
                        lang={lang}
                        colors={colors}
                        seen={seen}
                        open={openRunId === run.id}
                        focus={focusRunId === run.id}
                        onToggle={() => onToggleRun(openRunId === run.id ? null : run.id)}
                        onNavigate={onNavigate}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <DisclosureToggle open={showEarlier} onToggle={() => setShowEarlier((v) => !v)}>
            {showEarlier
              ? t("home.showLess")
              : t("home.activityShowEarlier", { count: earlierRuns.length })}
          </DisclosureToggle>
        </div>
      )}
    </section>
  );
}

function Head() {
  const { t } = useTranslation();
  return <SectionTitle icon={Clock} tone="tint-neutral" title={t("home.workTitle")} />;
}

function groupByDay(runs: RunFeedItem[], lang: string): Map<string, RunFeedItem[]> {
  const byDay = new Map<string, RunFeedItem[]>();
  for (const run of runs) {
    const key = dayLabel(run.startedAt, lang);
    byDay.set(key, [...(byDay.get(key) ?? []), run]);
  }
  return byDay;
}

/** The time gutter every row on the spine starts with. */
const GUTTER =
  "w-10 shrink-0 pt-0.5 text-right font-mono text-2xs tabular-nums leading-tight text-muted-foreground";

/** A run's clock time in the gutter; beyond today the weekday sits on its own line above it. */
function When({ iso, lang }: { iso: string; lang: string }) {
  const time = timeLabel(iso, lang);
  if (isToday(iso)) return <span className={GUTTER}>{time}</span>;
  return (
    <span className={cn(GUTTER, "flex flex-col")}>
      <span>{new Date(iso).toLocaleDateString(lang, { weekday: "short" })}</span>
      <span>{time}</span>
    </span>
  );
}

/**
 * The run in flight. Its tool trail is the point: the breathing mark and the
 * shimmering label name what it is doing right now, so "busy" is never the
 * whole answer. The trail is absent until the first tool call returns.
 */
function RunningRow({ run, index }: { run: RunFeedItem; index: number }) {
  const { t } = useTranslation();
  const steps = run.steps ?? [];
  return (
    <div className="animate-in-up flex items-start gap-2.5 rounded-md p-2.5" style={stagger(index)}>
      <span className={GUTTER}>{t("home.workNow")}</span>
      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          <span className="min-w-0 flex-1 truncate">
            {run.automationName ?? t("home.deletedAutomation")}
          </span>
          <RunTriggerBadge trigger={run.trigger} />
        </p>
        {steps.length === 0 ? (
          <p className="mt-0.5 text-xs text-shimmer">{t("home.workStarting")}</p>
        ) : (
          <ol className="mt-1 flex flex-col gap-1">
            {steps.map((step) => (
              <StepRow key={step.id} step={step} />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function StepRow({ step }: { step: RunStep }) {
  const { t } = useTranslation();
  const done = !!step.endedAt;
  return (
    <li className="flex items-center gap-2">
      <span
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          !done && "bg-accent",
          done && step.failed && "bg-destructive",
          done && !step.failed && "bg-foreground/25",
        )}
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-xs",
          done ? "text-muted-foreground" : "text-shimmer",
        )}
      >
        {step.label}
      </span>
      {!done && (
        <span className="shrink-0 font-mono text-2xs text-muted-foreground">
          {t("home.workStepRunning")}
        </span>
      )}
    </li>
  );
}

/** A scheduled run: read-only, and the quietest row on the spine. */
function ScheduledRow({
  automation,
  at,
  lang,
}: {
  automation: Automation;
  at: number;
  lang: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const iso = new Date(at).toISOString();
  return (
    <button
      type="button"
      onClick={() => navigate("/automations", { state: { focusAutomation: automation.id } })}
      className="surface-hover flex items-start gap-2.5 rounded-md p-2.5 text-left"
    >
      <When iso={iso} lang={lang} />
      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/20" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{automation.name}</p>
        <p className="text-xs text-muted-foreground">{t("home.workScheduled")}</p>
      </div>
    </button>
  );
}

/**
 * A finished run: gist on one line, unfolding into the run's own output. The
 * body is the briefing card when its turn composed one, else the result prose
 * plus the turn's other cards as siblings, never nested in this panel's surface.
 */
function FinishedRow({
  run,
  index,
  lang,
  colors,
  seen,
  open,
  focus,
  onToggle,
  onNavigate,
}: {
  run: RunFeedItem;
  index: number;
  lang: string;
  colors: AccountColor[];
  seen: Seen;
  open: boolean;
  /** Opened from the status line: scroll here and play the arrival flash. */
  focus: boolean;
  onToggle: () => void;
  onNavigate: (view: View) => void;
}) {
  const { t } = useTranslation();
  const [retrying, setRetrying] = React.useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (focus) ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focus]);
  const failed = run.status === "error";
  const briefing = findBriefingCard(run);
  const cards = (run.cards ?? []).filter(
    ({ card }) => card.kind !== "email_draft" && card.kind !== "message_draft",
  );
  const expandable = !!briefing || !!run.result || cards.length > 0;
  const isNew = seen.isNew(runSeenKey(run.id), run.startedAt);

  const toggle = () => {
    seen.see(runSeenKey(run.id));
    onToggle();
  };

  const retry = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setRetrying(true);
    try {
      await api.runAutomation(run.automationId);
    } catch (err) {
      toast.error(err);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div ref={ref} className={cn("rounded-md", focus && "flash-accent")}>
      <div
        className={cn(
          "animate-in-up flex items-start gap-2.5 rounded-md p-2.5",
          expandable && "surface-hover cursor-pointer",
        )}
        style={stagger(index)}
        {...(expandable ? toggleRowProps(open, toggle) : {})}
      >
        <When iso={run.startedAt} lang={lang} />
        <span
          className={cn(
            "mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full",
            failed ? "bg-destructive" : "bg-success",
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            {isNew && <NewDot />}
            <span className="min-w-0 flex-1 truncate">
              {run.automationName ?? t("home.deletedAutomation")}
            </span>
            <RunTriggerBadge trigger={run.trigger} />
          </p>
          <p className={cn("text-xs text-muted-foreground", !open && "line-clamp-2")}>
            {runSummary(run) || (failed ? t("home.workFailed") : "")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <OpenRunInChatButton
            conversationId={run.conversationId}
            onNavigateToChat={() => onNavigate("chat")}
          />
          {failed && run.automationName !== null && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("common.retry")}
              data-tooltip={t("common.retry")}
              loading={retrying}
              onClick={(e) => void retry(e)}
            >
              <RefreshCw />
            </Button>
          )}
          {expandable &&
            (open ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            ))}
        </div>
      </div>

      {open && (
        <div className="flex flex-col gap-3 px-2.5 pb-3 pt-1">
          {briefing ? (
            <BriefingCard card={briefing} colors={colors} runId={run.id} bare />
          ) : (
            run.result && <Markdown content={run.result} className="text-sm text-foreground/90" />
          )}
          {/* Sibling blocks, never nested in this panel's surface (DESIGN.md). */}
          {!briefing &&
            cards.map(({ toolCallId, card }) => (
              <AgentCardView key={toolCallId} card={card} colors={colors} />
            ))}
        </div>
      )}
    </div>
  );
}
