import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ErrorBanner, Notice } from "@/components/ui/feedback";
import { DraftReader, draftStack } from "@/features/drafts/DraftReader";
import { AttentionSection } from "@/features/home/AttentionSection";
import { upcomingRuns } from "@/features/home/agenda";
import { StatusLine } from "@/features/home/StatusLine";
import { draftSeenKey, outboundSeenKey, todoSeenKey, useSeen } from "@/features/home/seen";
import { findBriefingCard, freshRuns, runSummary, WorkSection } from "@/features/home/WorkSection";
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
  const queryError = draftsQuery.error ?? runsQuery.error ?? automationsQuery.error;
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

  // One run unfolds at a time, and the status line's briefing button opens it,
  // so the open row lives here rather than inside the work column. Opened from
  // the status line the row also scrolls into view and flashes, since the
  // button sits across the page from its effect; a click on the row itself
  // does neither.
  const [openRunId, setOpenRunId] = React.useState<string | null>(null);
  const [focusRunId, setFocusRunId] = React.useState<string | null>(null);
  const toggleRun = (runId: string | null) => {
    setOpenRunId(runId);
    setFocusRunId(null);
  };

  const todos = todosQuery.data ?? [];
  const outbound = outboundQuery.data ?? [];
  const approvals =
    outbound.length + (drafts ?? []).reduce((n, account) => n + account.drafts.length, 0);
  const needsYou = todos.length + approvals;
  const mine =
    (runs ?? []).filter((run) => run.status === "running").length +
    upcomingRuns(automations).length;

  // The newest run whose turn composed a briefing: its headline rides the
  // status line, and the line's button unfolds this row.
  const briefingRun = (runs ?? []).find((run) => run.status === "success" && findBriefingCard(run));
  const briefing = briefingRun && {
    name: briefingRun.automationName ?? t("home.deletedAutomation"),
    startedAt: briefingRun.startedAt,
    headline: runSummary(briefingRun),
  };
  const openBriefing = () => {
    if (!briefingRun) return;
    setOpenRunId(briefingRun.id);
    setFocusRunId(briefingRun.id);
  };

  const newCount =
    [
      ...todos.map((todo) => [todoSeenKey(todo.id), todo.createdAt] as const),
      ...outbound.map((draft) => [outboundSeenKey(draft.id), draft.createdAt] as const),
      ...(drafts ?? []).flatMap((account) =>
        account.drafts.map(
          (draft) => [draftSeenKey(account.accountId, draft.id), draft.date] as const,
        ),
      ),
    ].filter(([key, createdAt]) => seen.isNew(key, createdAt)).length +
    freshRuns(runs, seen).length;

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
        key={`${entry.accountId}:${entry.draft.id}`}
        entry={entry}
        stack={stack}
        onClose={closeDraft}
        onOpen={openDraft}
        onChanged={refreshDrafts}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8 pt-1">
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

      <StatusLine
        needsYou={needsYou}
        mine={mine}
        briefing={briefing}
        onOpenBriefing={openBriefing}
      />

      {newCount > 0 && (
        <div className="-mb-4 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{t("home.newCount", { count: newCount })}</p>
          <Button variant="ghost" size="sm" onClick={seen.seeAll}>
            <CheckCheck />
            {t("home.markAllSeen")}
          </Button>
        </div>
      )}

      {/* Two stacks: what waits on you, what the agent does itself. Side by side
          as soon as the canvas can hold two draft rows, stacked below that. */}
      <div className="grid grid-cols-1 items-start gap-8 @3xl:grid-cols-2 @3xl:gap-7">
        <AttentionSection
          drafts={drafts}
          colors={colors}
          onOpenDraft={openDraft}
          onDraftsChanged={refreshDrafts}
          automations={automations}
          onNavigate={onNavigate}
          seen={seen}
        />
        <WorkSection
          runs={runs}
          automations={automations}
          colors={colors}
          onNavigate={onNavigate}
          seen={seen}
          openRunId={openRunId}
          focusRunId={focusRunId}
          onToggleRun={toggleRun}
        />
      </div>
    </div>
  );
}
