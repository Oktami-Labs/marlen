import type { AccountColor, PinnedRun, RunFeedItem } from "@marlen/shared";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ExpandButton } from "@/components/ui/disclosure-toggle";
import { RunReport } from "@/features/home/RunReport";
import { isAutomationRunning } from "@/features/home/runs";
import { NewDot, runSeenKey, type Seen } from "@/features/home/seen";
import { api } from "@/lib/api";
import { dayTimeLabel } from "@/lib/dates";
import { toast } from "@/lib/toast";
import { withViewTransition } from "@/lib/utils";

const COLLAPSED_KEY = "marlen-home-pinned-collapsed";

/**
 * The pinned automations' latest results, above both Home columns and read
 * without a click. One is on screen at a time; the arrows page through them
 * in the automations list's order and wrap at either end, and the whole band
 * folds to its header row, which is remembered across sessions.
 */
export function PinnedReports({
  items,
  runs,
  colors,
  onOpenRun,
  seen,
}: {
  /** Null while the first fetch is in flight; empty when nothing is pinned. */
  items: PinnedRun[] | null;
  /** The run feed, read only to light the refresh button while a re-run is in flight. */
  runs: RunFeedItem[] | null;
  colors: AccountColor[];
  /** Opens a run's page in place of Home. */
  onOpenRun: (runId: string) => void;
  seen: Seen;
}) {
  const { t, i18n } = useTranslation();
  const [cursor, setCursor] = React.useState(0);
  const [collapsed, setCollapsed] = React.useState(
    () => localStorage.getItem(COLLAPSED_KEY) === "true",
  );
  const [starting, setStarting] = React.useState(false);

  const count = items?.length ?? 0;
  // Modulo, not clamp: it both wraps the arrows and survives a pin leaving the band.
  const index = count > 0 ? cursor % count : 0;
  const current = items?.[index];

  const fold = (next: boolean) => {
    localStorage.setItem(COLLAPSED_KEY, String(next));
    withViewTransition(() => setCollapsed(next));
  };
  const page = (delta: number) =>
    withViewTransition(() => setCursor((count + index + delta) % count));

  if (!current) return null;

  const { automation, run } = current;
  const newKey = run && seen.isNew(runSeenKey(run.id), run.startedAt) ? runSeenKey(run.id) : null;
  const running = isAutomationRunning(runs, automation.id);

  const refresh = async () => {
    setStarting(true);
    try {
      await api.runAutomation(automation.id);
    } catch (error) {
      toast.error(error);
    } finally {
      setStarting(false);
    }
  };

  return (
    <section
      className="flex flex-col gap-2"
      // A click anywhere in the band is a look at this result.
      onClickCapture={newKey ? () => seen.see(newKey) : undefined}
    >
      <div className="flex h-9 items-center gap-1.5 px-3">
        <ExpandButton open={!collapsed} onToggle={() => fold(!collapsed)} />
        {newKey && <NewDot />}
        {run ? (
          <button
            type="button"
            onClick={() => onOpenRun(run.id)}
            data-tooltip={t("home.pinnedOpen")}
            className="min-w-0 rounded-md text-left transition-colors hover:text-accent-text"
          >
            <h2 className="truncate text-sm font-semibold tracking-tight">{automation.name}</h2>
          </button>
        ) : (
          <h2 className="min-w-0 truncate text-sm font-semibold tracking-tight">
            {automation.name}
          </h2>
        )}
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {run ? dayTimeLabel(run.startedAt, i18n.language) : t("home.pinnedNoRun")}
        </span>
        <div className="flex-1" />
        {count > 1 && (
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("home.pinnedPrevious")}
              data-tooltip={t("home.pinnedPrevious")}
              onClick={() => page(-1)}
            >
              <ChevronLeft />
            </Button>
            <span className="text-xs tabular-nums text-muted-foreground">
              {index + 1}/{count}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("home.pinnedNext")}
              data-tooltip={t("home.pinnedNext")}
              onClick={() => page(1)}
            >
              <ChevronRight />
            </Button>
          </div>
        )}
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
      </div>

      {!collapsed &&
        (run ? (
          <RunReport key={run.id} run={run} colors={colors} />
        ) : (
          <p className="px-3 text-sm text-muted-foreground">{t("home.pinnedNoRunBody")}</p>
        ))}
    </section>
  );
}
