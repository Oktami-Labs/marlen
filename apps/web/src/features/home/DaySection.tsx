import type { Automation, RunFeedItem } from "@marlen/shared";
import { CalendarClock, CircleAlert, Inbox, Newspaper, Zap } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { AccountDot } from "@/components/ui/account-dot";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingRow } from "@/components/ui/feedback";
import { GroupLabel } from "@/components/ui/group-label";
import { DAY_MS, startOfDayMs } from "@/features/home/agenda";
import { COLUMN_HEAD } from "@/features/home/NeedsYouSection";
import { routineRun, runSummary } from "@/features/home/runs";
import { NewDot, runSeenKey, type Seen, SeenOnInteract } from "@/features/home/seen";
import { isToday, shortDateLabel, timeLabel, weekdayLabel } from "@/lib/dates";
import type { View } from "@/lib/nav";
import { cn, stagger } from "@/lib/utils";

/** The current minute, so the now line and the past/upcoming split follow the clock. */
function useNow(): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    let timer = 0;
    const arm = () => {
      timer = window.setTimeout(
        () => {
          setNow(Date.now());
          arm();
        },
        60_000 - (Date.now() % 60_000),
      );
    };
    arm();
    return () => window.clearTimeout(timer);
  }, []);
  return now;
}

/** The gutter reads the clock for today; a run still going since another day shows its weekday. */
function gutterLabel(iso: string, lang: string): string {
  return isToday(iso) ? timeLabel(iso, lang) : weekdayLabel(iso, lang);
}

/** Enabled automations with a next run, soonest first. */
function scheduledRuns(automations: Automation[] | null): { automation: Automation; at: number }[] {
  return (automations ?? [])
    .filter((a) => a.enabled && a.nextRunAt)
    .map((a) => ({ automation: a, at: new Date(a.nextRunAt as string).getTime() }))
    .sort((a, b) => a.at - b.at);
}

/**
 * "Heute": the agent's day on one time axis. What it did sits above the now
 * line, what is scheduled below it, and tomorrow's runs under their own
 * label. A row is one line: the time in a mono gutter, a glyph for the kind
 * of thing, the gist. A routine run, one that found nothing, is muted. Every
 * row kind renders through `DayRow`, so calendar or message events can join
 * the axis without a new component.
 */
export function DaySection({
  runs,
  hiddenRunIds,
  automations,
  onOpenRun,
  onNavigate,
  seen,
}: {
  /** Null while the first fetch is in flight. */
  runs: RunFeedItem[] | null;
  /** Runs the pinned band already shows in full, so the day never says a thing twice. */
  hiddenRunIds: ReadonlySet<string>;
  automations: Automation[] | null;
  /** Opens a run's page in place of Home. */
  onOpenRun: (runId: string) => void;
  onNavigate: (view: View) => void;
  seen: Seen;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const navigate = useNavigate();
  const now = useNow();
  const tomorrowStart = startOfDayMs(new Date(now)) + DAY_MS;

  // The feed arrives newest first; the day reads top-down. Sorted once per
  // feed, not once per minute tick.
  const finished = React.useMemo(
    () =>
      (runs ?? [])
        .filter(
          (run) => run.status !== "running" && !hiddenRunIds.has(run.id) && isToday(run.startedAt),
        )
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
    [runs, hiddenRunIds],
  );
  const running = React.useMemo(
    () => (runs ?? []).filter((run) => run.status === "running"),
    [runs],
  );
  const scheduled = React.useMemo(() => scheduledRuns(automations), [automations]);

  const head = (
    <div className={COLUMN_HEAD}>
      <GroupLabel as="h2">{t("home.todosToday")}</GroupLabel>
    </div>
  );

  if (runs === null) {
    return (
      <section className="flex flex-col">
        {head}
        <LoadingRow className="px-3" />
      </section>
    );
  }

  const upcoming = scheduled.filter(({ at }) => at >= now && at < tomorrowStart);
  const tomorrow = scheduled.filter(({ at }) => at >= tomorrowStart && at < tomorrowStart + DAY_MS);
  const past = finished.length + running.length;

  if (past + upcoming.length + tomorrow.length === 0) {
    const hasAutomations = (automations?.length ?? 0) > 0;
    return (
      <section className="flex flex-col">
        {head}
        <EmptyState
          surface={false}
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

  const openAutomation = (automation: Automation) =>
    navigate(`/automations?automation=${encodeURIComponent(automation.id)}`);

  let index = 0;
  const runRow = (run: RunFeedItem) => (
    <SeenOnInteract
      key={run.id}
      seen={seen}
      itemKey={runSeenKey(run.id)}
      createdAt={run.startedAt}
      className="animate-in-up"
      style={stagger(index++)}
    >
      {(isNew) => (
        <DayRow
          at={run.startedAt}
          time={gutterLabel(run.startedAt, lang)}
          icon={runIcon(run)}
          title={runTitle(run, t("home.deletedAutomation"))}
          tooltip={runSummary(run)}
          muted={routineRun(run)}
          isNew={isNew}
          onPress={() => onOpenRun(run.id)}
        />
      )}
    </SeenOnInteract>
  );

  return (
    <section className="flex flex-col">
      {head}
      {finished.map((run) => runRow(run))}
      {running.map((run) => (
        <RunningRow key={run.id} run={run} lang={lang} style={stagger(index++)} />
      ))}
      <NowLine time={timeLabel(new Date(now).toISOString(), lang)} label={t("home.now")} />
      {upcoming.map(({ automation, at }) => (
        <DayRow
          key={automation.id}
          at={new Date(at).toISOString()}
          time={timeLabel(new Date(at).toISOString(), lang)}
          icon={<CalendarClock />}
          title={automation.name}
          className="animate-in-up"
          style={stagger(index++)}
          onPress={() => openAutomation(automation)}
        />
      ))}
      {past + upcoming.length === 0 && (
        <p className="px-3 py-1.5 text-xs text-muted-foreground">
          {t("home.activityNothingToday")}
        </p>
      )}
      {tomorrow.length > 0 && (
        <>
          <GroupLabel className="px-3 pb-0.5 pt-3">
            {t("home.todosTomorrow")} ·{" "}
            {shortDateLabel(new Date(tomorrowStart).toISOString(), lang)}
          </GroupLabel>
          {tomorrow.map(({ automation, at }) => (
            <DayRow
              key={automation.id}
              at={new Date(at).toISOString()}
              time={timeLabel(new Date(at).toISOString(), lang)}
              icon={<CalendarClock />}
              title={automation.name}
              className="animate-in-up"
              style={stagger(index++)}
              onPress={() => openAutomation(automation)}
            />
          ))}
        </>
      )}
    </section>
  );
}

/** A run leads with its name so the name survives the clip, and the gist
 *  follows in quieter ink. */
function runTitle(run: RunFeedItem, deletedLabel: string): React.ReactNode {
  const name = run.automationName ?? deletedLabel;
  const gist = runSummary(run);
  return (
    <>
      {name}
      {gist && <span className="text-muted-foreground"> · {gist}</span>}
    </>
  );
}

/** The glyph for a run: what led to it, or that it failed. */
export function runIcon(run: RunFeedItem): React.ReactNode {
  if (run.status === "error") return <CircleAlert className="text-destructive" />;
  switch (run.trigger?.kind) {
    case "mail":
      return <Inbox />;
    case "todo":
      return <Zap />;
    default:
      return <CalendarClock />;
  }
}

const GUTTER = "w-[38px] shrink-0 whitespace-nowrap text-right font-mono text-2xs tabular-nums";

/** One line of the day: the gutter, a 15px glyph, the title. */
function DayRow({
  at,
  time,
  icon,
  title,
  tooltip,
  muted,
  isNew,
  onPress,
  className,
  style,
}: {
  at: string;
  /** What the gutter reads, the clock unless the caller says otherwise. */
  time: string;
  icon: React.ReactNode;
  title: React.ReactNode;
  tooltip?: string;
  /** A routine row, nothing to look at: quieter ink. */
  muted?: boolean;
  isNew?: boolean;
  onPress?: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const body = (
    <>
      <time dateTime={at} className={cn(GUTTER, "text-muted-foreground")}>
        {time}
      </time>
      <span
        className={cn(
          "flex w-[18px] shrink-0 justify-center [&_svg]:size-[15px]",
          muted ? "text-muted-foreground/70" : "text-muted-foreground",
        )}
      >
        {icon}
      </span>
      <span
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium",
          muted ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {isNew && <NewDot />}
        <span className="truncate">{title}</span>
      </span>
    </>
  );
  const rowClass = cn(
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left",
    className,
  );
  return onPress ? (
    <button
      type="button"
      onClick={onPress}
      data-tooltip={tooltip}
      className={cn(rowClass, "transition-colors hover:bg-surface-2")}
      style={style}
    >
      {body}
    </button>
  ) : (
    <div className={rowClass} data-tooltip={tooltip} style={style}>
      {body}
    </div>
  );
}

/** The run in flight: its start time, a breathing mark, and the step it is on. */
function RunningRow({
  run,
  lang,
  style,
}: {
  run: RunFeedItem;
  lang: string;
  style?: React.CSSProperties;
}) {
  const { t } = useTranslation();
  const step = run.steps?.find((s) => !s.endedAt);
  const doing = step?.label ?? (run.steps?.length ? null : t("home.workStarting"));
  return (
    <DayRow
      at={run.startedAt}
      time={gutterLabel(run.startedAt, lang)}
      icon={<AccountDot tone="accent" className="dot-breathe h-2 w-2" />}
      title={
        <>
          {run.automationName ?? t("home.deletedAutomation")}
          {doing && (
            <>
              {" · "}
              <span className="text-shimmer">{doing}</span>
            </>
          )}
        </>
      }
      className="animate-in-up"
      style={style}
    />
  );
}

/** The present moment on the axis: the clock, an accent dot, a rule, "Jetzt". */
function NowLine({ time, label }: { time: string; label: string }) {
  return (
    <div className="flex items-center gap-3 px-2.5 py-1.5">
      <span className={cn(GUTTER, "font-medium text-accent-text")}>{time}</span>
      <AccountDot tone="accent" className="h-2 w-2" />
      <span className="now-line h-px flex-1" />
      <span className="text-2xs font-semibold uppercase tracking-wider text-accent-text">
        {label}
      </span>
    </div>
  );
}
