import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ErrorBanner, Notice } from "@/components/ui/feedback";
import { DraftReader, draftStack } from "@/features/drafts/DraftReader";
import { DaySection } from "@/features/home/DaySection";
import { NeedsYouSection } from "@/features/home/NeedsYouSection";
import { ReportPage } from "@/features/home/ReportPage";
import { freshRuns, pickReport } from "@/features/home/runs";
import { todoSeenKey, useSeen } from "@/features/home/seen";
import { useAccountColors } from "@/lib/accounts";
import { api } from "@/lib/api";
import type { View } from "@/lib/nav";
import { toast } from "@/lib/toast";
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

  // Fetched here even though the left column renders approval rows from the
  // todos list: the server files and closes those rows while answering this request.
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

  // `?draft=<accountId>:<draftId>` IS the reading screen and `?report=<runId>`
  // the report's: the rows and the search palette open one by writing it, so
  // back closes the page and a link to one survives a reload.
  const [searchParams, setSearchParams] = useSearchParams();
  const draftParam = searchParams.get("draft");
  const separator = draftParam?.indexOf(":") ?? -1;
  const selected =
    draftParam && separator > 0
      ? { accountId: draftParam.slice(0, separator), draftId: draftParam.slice(separator + 1) }
      : null;
  const openDraft = (accountId: string, draftId: string) =>
    setSearchParams({ draft: `${accountId}:${draftId}` });
  const reportParam = searchParams.get("report");
  const openRun = (runId: string) => setSearchParams({ report: runId });
  const closePage = () => setSearchParams({}, { replace: true });

  // The report leaves the day list only once both lists are in; split earlier,
  // its row would sit lower for a beat and then jump to the top.
  const loaded = runs !== null && !pinnedQuery.isPending;
  const pinned = pinnedQuery.data?.run;
  const report = loaded ? pickReport(pinned, runs) : null;
  const reportRun = reportParam
    ? (runs?.find((run) => run.id === reportParam) ??
      (pinned?.id === reportParam ? pinned : undefined))
    : undefined;

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

  // Selected but not in the list: it was sent, discarded or trimmed elsewhere,
  // so the page has nothing to show and Home is the honest answer, said out loud.
  const draftGone = Boolean(selected && drafts && !entry);
  const reportGone = Boolean(reportParam && loaded && !reportRun);
  React.useEffect(() => {
    if (!draftGone && !reportGone) return;
    toast.info(t(draftGone ? "home.draftGone" : "home.reportGone"));
    setSearchParams({}, { replace: true });
  }, [draftGone, reportGone, setSearchParams, t]);

  if (entry) {
    return (
      <DraftReader
        key={`${entry.accountId}:${entry.draft.id}`}
        entry={entry}
        stack={stack}
        onClose={closePage}
        onOpen={openDraft}
        onChanged={refreshDrafts}
      />
    );
  }

  if (reportRun) {
    return (
      <ReportPage
        key={reportRun.id}
        run={reportRun}
        runs={runs}
        colors={colors}
        onNavigate={onNavigate}
        onClose={closePage}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6 pt-1">
      {error && !offline && <ErrorBanner>{error}</ErrorBanner>}

      {setupIncomplete ? (
        <div className="flex flex-wrap items-center gap-3 px-3 text-sm text-warning">
          <TriangleAlert className="h-4 w-4 shrink-0" />
          <p className="min-w-0 flex-1">{t("home.setupBanner")}</p>
          <Button size="sm" onClick={() => onNavigate("settings")}>
            {t("home.setupBannerCta")}
          </Button>
        </div>
      ) : offline ? (
        <Notice tone="warning" className="flex items-center gap-3">
          <p className="text-sm">{t("home.offlineBanner")}</p>
        </Notice>
      ) : null}

      {/* What needs you beside the day. Two columns from `@2xl`, the step at which
          both still stand beside the docked chat; stacked below that. */}
      <div
        data-home-grid
        className="grid grid-cols-1 items-start gap-8 @2xl:grid-cols-[minmax(0,1.22fr)_minmax(0,1fr)] @2xl:gap-3.5"
      >
        <NeedsYouSection
          drafts={drafts}
          onOpenDraft={openDraft}
          onDraftsChanged={refreshDrafts}
          automations={automations}
          onNavigate={onNavigate}
          seen={seen}
          newCount={newCount}
        />
        <DaySection
          runs={runs}
          report={report}
          automations={automations}
          onOpenRun={openRun}
          onNavigate={onNavigate}
          seen={seen}
        />
      </div>
    </div>
  );
}
