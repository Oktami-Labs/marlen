import { Sparkles } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { ChangelogDialog } from "@/components/ChangelogDialog";
import { Button } from "@/components/ui/button";
import { desktopBridge, type UpdateState } from "@/lib/desktop";
import { cn } from "@/lib/utils";

/* Lets the showcase preview an update without the desktop bridge. */
let showcaseVersion: string | null = null;
const showcaseListeners = new Set<() => void>();

export function setShowcaseUpdate(version: string | null) {
  showcaseVersion = version;
  for (const notify of showcaseListeners) notify();
}

function subscribeShowcase(onChange: () => void) {
  showcaseListeners.add(onChange);
  return () => {
    showcaseListeners.delete(onChange);
  };
}

/**
 * What the shell knows about the newest release, or null when no newer version
 * exists. Desktop shell only: without a bridge (the browser, the dev server) it
 * stays null.
 */
export function useUpdateState(): UpdateState | null {
  const [state, setState] = React.useState<UpdateState | null>(null);
  const showcase = React.useSyncExternalStore(subscribeShowcase, () => showcaseVersion);

  React.useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge) return;
    void bridge.getUpdateState().then((current) => {
      if (current.version) setState(current);
    });
    return bridge.onUpdateState(setState);
  }, []);

  if (showcase) return { version: showcase, ready: true, manual: false };
  return state?.version ? state : null;
}

// Announce each version once per launch.
const announced = new Set<string>();

export function UpdatePill({ state, isCollapsed }: { state: UpdateState; isCollapsed: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const label = t(state.ready ? "app.updateAvailable" : "app.updateWaiting");

  const version = state.version ?? "";
  React.useEffect(() => {
    if (!version || announced.has(version)) return;
    announced.add(version);
    setOpen(true);
  }, [version]);

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className={cn(
          "animate-in-up update-pill w-full shrink-0 px-3",
          isCollapsed && "md:w-9 md:px-0",
        )}
        aria-label={label}
        data-tooltip={isCollapsed ? label : undefined}
      >
        <Sparkles />
        <span className={cn(isCollapsed && "md:hidden")}>{label}</span>
      </Button>
      <ChangelogDialog open={open} onOpenChange={setOpen} pending={state} />
    </>
  );
}
