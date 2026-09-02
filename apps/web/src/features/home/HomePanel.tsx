import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ErrorBanner, Notice } from "@/components/ui/feedback";
import { DraftReader, draftStack } from "@/features/drafts/DraftReader";
import { AttentionSection } from "@/features/home/AttentionSection";
import { BriefingSection, pickReport } from "@/features/home/BriefingSection";
import { todoSeenKey, useSeen } from "@/features/home/seen";
import { freshRuns, WorkSection } from "@/features/home/WorkSection";
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

  // Fetched here even though the agenda renders approval rows from the todos
  // list: the server files and closes those rows while answering this request.
  const draftsQuery = useQuery({ queryKey: ["drafts", "review"], queryFn: () => api.drafts() });
  const runsQuery = useQuery({ queryKey: ["runs", "feed"], queryFn: () => api.runsFeed() });
  const pinnedQuery = useQuery({ queryKey: ["runs", "pinned"], queryFn: () => api.pinnedRun() });
  const automationsQuery = useQuery({
    queryKey: ["automations", "list"],
    queryFn: () => api.automations(),
  });
  const todosQuery = useQuery({ queryKey: ["todos"], queryFn: () => api.todos("open") });
  const { colors } = useAccountColors({ withAccounts: false });
  const seen = useSeen();

  const drafts = draftsQuery.data ?? null;
  const runs = runsQuery.data?.items ?? null;
  const automations = automationsQuery.data ?? null;
  const queryError =
    draftsQuery.error ?? runsQuery.error ?? pinnedQuery.error ?? automationsQuery.error;
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

  // The report leaves the log only once both lists are in; split earlier, its
  // row would sit in the log for a beat and then jump up into the briefing.
  const loaded = runs !== null && !pinnedQuery.isPending;
  const report = loaded ? pickReport(pinnedQuery.data?.run, runs) : null;
  const logRuns = loaded ? runs.filter((run) => run.id !== report?.id) : null;

  const todos = todosQuery.data ?? [];
  const newCount =
    todos.filter((todo) => seen.isNew(todoSeenKey(todo.id), todo.createdAt)).length +
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

      {/* Two stacks: what waits on you, and what the agent reports and does.
          Side by side as soon as the canvas can hold two draft rows, stacked
          below that. */}
      <div className="grid grid-cols-1 items-start gap-8 @3xl:grid-cols-2 @3xl:gap-7">
        <AttentionSection
          drafts={drafts}
          colors={colors}
          onOpenDraft={openDraft}
          onDraftsChanged={refreshDrafts}
          automations={automations}
          onNavigate={onNavigate}
          seen={seen}
          newCount={newCount}
        />
        <div className="flex flex-col gap-8">
          {report && (
            <BriefingSection
              run={report}
              runs={runs}
              colors={colors}
              onNavigate={onNavigate}
              seen={seen}
            />
          )}
          <WorkSection
            runs={logRuns}
            automations={automations}
            colors={colors}
            onNavigate={onNavigate}
            seen={seen}
          />
        </div>
      </div>
    </div>
  );
}
