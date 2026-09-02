import { type AppStatus, isSetupComplete } from "@marlen/shared";
import * as React from "react";
import { Route, Routes } from "react-router-dom";
import { NotFound } from "@/components/NotFound";
import { LoadingRow } from "@/components/ui/feedback";
import { HomePanel } from "@/features/home/HomePanel";
import type { View } from "@/lib/nav";

const AutomationsPanel = React.lazy(() =>
  import("@/features/automations/AutomationsPanel").then(({ AutomationsPanel }) => ({
    default: AutomationsPanel,
  })),
);
const KnowledgePanel = React.lazy(() =>
  import("@/features/knowledge/KnowledgePanel").then(({ KnowledgePanel }) => ({
    default: KnowledgePanel,
  })),
);
const LeadsPanel = React.lazy(() =>
  import("@/features/leads/LeadsPanel").then(({ LeadsPanel }) => ({ default: LeadsPanel })),
);
const SettingsPanel = React.lazy(() =>
  import("@/features/settings/SettingsPanel").then(({ SettingsPanel }) => ({
    default: SettingsPanel,
  })),
);
const ShowcasePanel = import.meta.env.DEV
  ? React.lazy(() =>
      import("@/features/showcase/ShowcasePanel").then(({ ShowcasePanel }) => ({
        default: ShowcasePanel,
      })),
    )
  : null;

/**
 * The routed page, memoized so the shell's own state (chat search text, drawer
 * flags, a resize drag) re-renders the chrome and not the page under it.
 */
export const Pages = React.memo(function Pages({
  status,
  onStatusChanged,
  onNavigate,
}: {
  status: AppStatus | null;
  onStatusChanged: () => void;
  onNavigate: (view: View) => void;
}) {
  return (
    <React.Suspense fallback={<LoadingRow />}>
      <Routes>
        <Route path="/chat" element={null} />
        <Route
          path="/settings"
          element={<SettingsPanel status={status} onStatusChanged={onStatusChanged} />}
        />
        <Route path="/leads" element={<LeadsPanel />} />
        <Route path="/automations" element={<AutomationsPanel />} />
        <Route path="/knowledge" element={<KnowledgePanel />} />
        {ShowcasePanel && <Route path="/showcase" element={<ShowcasePanel />} />}
        <Route
          path="/"
          element={
            <HomePanel
              setupIncomplete={status !== null && !isSetupComplete(status)}
              offline={Boolean(status?.pipedreamConfigured) && !status?.emailAccountsKnown}
              onNavigate={onNavigate}
            />
          }
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </React.Suspense>
  );
});
