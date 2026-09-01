import type { MissedAutomation, RunFeedItem } from "@marlen/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ErrorBanner, Notice } from "@/components/ui/feedback";
import { DraftReader, draftStack } from "@/features/drafts/DraftReader";
import { ActivitySection } from "@/features/home/ActivitySection";
import { AttentionSection } from "@/features/home/AttentionSection";
import { BriefingHero, findBriefingCard } from "@/features/home/BriefingHero";
import { freshResultRuns, ResultsSection } from "@/features/home/ResultsSection";
import {
  draftSeenKey,
  outboundSeenKey,
  runSeenKey,
  todoSeenKey,
  useSeen,
} from "@/features/home/seen";
import { useAccountColors } from "@/lib/accounts";
import { api } from "@/lib/api";
import type { View } from "@/lib/nav";
import { errorMessage } from "@/lib/utils";

export function HomePanel({
  setupIncomplete,
  offline,
  onNavigate,
}: {
  setupIncomplete: boolean;
  offline: boolean;
  onNavigate: (view: View) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const draftsQuery = useQuery({ queryKey: ["drafts", "review"], queryFn: () => api.drafts() });
  const runsQuery = useQuery({ queryKey: ["runs", "feed"], queryFn: () => api.runsFeed() });
  const automationsQuery = useQuery({
    queryKey: ["automations", "list"],
    queryFn: () => api.automations(),
  });
  const pinnedQuery = useQuery({ queryKey: ["runs", "pinned"], queryFn: () => api.pinnedRun() });
  const missedQuery = useQuery({ queryKey: ["runs", "missed"], queryFn: () => api.missedRuns() });
  const todosQuery = useQuery({ queryKey: ["todos"], queryFn: () => api.todos("open") });
  const outboundQuery = useQuery({
    queryKey: ["outbound", "open"],
    queryFn: () => api.outbound("open"),
  });
  const { colors } = useAccountColors({ withAccounts: false });
  const seen = useSeen();

  const drafts = draftsQuery.data ?? null;
  const runs = runsQuery.data?.items ?? null;
  const automations = automationsQuery.data ?? null;
  const pinned = pinnedQuery.data ?? null;
  const missed = missedQuery.data?.items ?? [];
  const queryError =
    draftsQuery.error ??
    runsQuery.error ??
    automationsQuery.error ??
    pinnedQuery.error ??
    missedQuery.error;
  const error = queryError ? errorMessage(queryError) : null;

  const refreshDrafts = () => void queryClient.invalidateQueries({ queryKey: ["drafts"] });

  // `?draft=<accountId>:<draftId>` IS the reading screen: the approval list and
  // the search palette both open a draft by writing it, so back closes the
  // letter and a link to one survives a reload.
  const [searchParams, setSearchParams] = useSearchParams();
  const draftParam = searchParams.get("draft");
  const separator = draftParam?.indexOf(":") ?? -1;
  const selected =
    draftParam && separator > 0
      ? { accountId: draftParam.slice(0, separator), draftId: draftParam.slice(separator + 1) }
      : null;
  const openDraft = (accountId: string, draftId: string) =>
    setSearchParams({ draft: `${accountId}:${draftId}` });
  const closeDraft = () => setSearchParams({}, { replace: true });

  // Prefer the pinned run, then the newest successful briefing.
  const heroRun = React.useMemo(() => {
    if (pinned?.run) return pinned.run;
    if (!runs) return null;
    let best: RunFeedItem | null = null;
    for (const run of runs) {
      if (run.status !== "success") continue;
      if (!findBriefingCard(run)) continue;
      if (!best || new Date(run.startedAt).getTime() > new Date(best.startedAt).getTime()) {
        best = run;
      }
    }
    return best;
  }, [runs, pinned]);

  const activityRuns = React.useMemo(() => {
    if (!runs) return runs;
    return heroRun ? runs.filter((r) => r.id !== heroRun.id) : runs;
  }, [runs, heroRun]);

  const newCount = [
    ...(todosQuery.data ?? []).map((todo) => [todoSeenKey(todo.id), todo.createdAt] as const),
    ...(outboundQuery.data ?? []).map(
      (draft) => [outboundSeenKey(draft.id), draft.createdAt] as const,
    ),
    ...(drafts ?? []).flatMap((account) =>
      account.drafts.map(
        (draft) => [draftSeenKey(account.accountId, draft.id), draft.date] as const,
      ),
    ),
    ...freshResultRuns(activityRuns, heroRun?.automationId).map(
      ({ run }) => [runSeenKey(run.id), run.startedAt] as const,
    ),
  ].filter(([key, createdAt]) => seen.isNew(key, createdAt)).length;

  const stack = draftStack(drafts);
  const entry = selected
    ? stack.find(
        (item) => item.accountId === selected.accountId && item.draft.id === selected.draftId,
      )
    : undefined;

  // Selected but not in the list: it was sent or discarded elsewhere, so the
  // letter has nothing to show and the list is the honest answer.
  const missing = Boolean(selected && drafts && !entry);
  React.useEffect(() => {
    if (missing) setSearchParams({}, { replace: true });
  }, [missing, setSearchParams]);

  if (entry) {
    return (
      <DraftReader
        entry={entry}
        stack={stack}
        onClose={closeDraft}
        onOpen={openDraft}
        onChanged={refreshDrafts}
      />
    );
  }

  return (
    <div className="flex flex-col gap-10 pt-1">
      {error && !offline && <ErrorBanner>{error}</ErrorBanner>}

      {setupIncomplete ? (
        <Notice tone="warning" className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">{t("home.setupBanner")}</p>
          <Button size="sm" onClick={() => onNavigate("settings")}>
            {t("home.setupBannerCta")}
          </Button>
        </Notice>
      ) : offline ? (
        <Notice tone="warning" className="flex items-center gap-3">
          <p className="text-sm">{t("home.offlineBanner")}</p>
        </Notice>
      ) : null}

      {missed.length > 0 && <MissedRunsBanner missed={missed} />}

      {newCount > 0 && (
        <div className="-mb-6 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{t("home.newCount", { count: newCount })}</p>
          <Button variant="ghost" size="sm" onClick={seen.seeAll}>
            <CheckCheck />
            {t("home.markAllSeen")}
          </Button>
        </div>
      )}

      {heroRun && (
        <BriefingHero
          run={heroRun}
          runs={runs}
          onNavigate={onNavigate}
          colors={colors}
          nextRunAt={
            pinned?.automation?.nextRunAt ??
            automations?.find((a) => a.id === heroRun.automationId)?.nextRunAt
          }
        />
      )}

      <AttentionSection
        automations={automations}
        drafts={drafts}
        colors={colors}
        onOpenDraft={openDraft}
        onDraftsChanged={refreshDrafts}
        onNavigate={onNavigate}
        seen={seen}
      />
      <ResultsSection
        runs={activityRuns}
        heroAutomationId={heroRun?.automationId}
        colors={colors}
        onNavigate={onNavigate}
        seen={seen}
      />
      <ActivitySection
        runs={activityRuns}
        automations={automations}
        colors={colors}
        onNavigate={onNavigate}
        hasHero={!!heroRun}
      />
    </div>
  );
}

function MissedRunsBanner({ missed }: { missed: MissedAutomation[] }) {
  const { t } = useTranslation();
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      await api.runMissed();
    } catch (e) {
      setError(errorMessage(e));
      setRunning(false);
    }
  };

  return (
    <Notice tone="warning" className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm">{error ?? t("home.missedBanner", { count: missed.length })}</p>
        {!error && (
          <p className="truncate text-xs opacity-80">{missed.map((m) => m.name).join(", ")}</p>
        )}
      </div>
      <Button size="sm" onClick={run} disabled={running}>
        {running ? t("home.missedRunning") : t("home.missedRun")}
      </Button>
    </Notice>
  );
}
