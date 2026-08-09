import { Sparkles } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { ChangelogDialog } from "@/components/ChangelogDialog";
import { Button } from "@/components/ui/button";
import { desktopBridge, type UpdateState } from "@/lib/desktop";
import { cn } from "@/lib/utils";

/* DEV showcase override — delete with the /showcase route. The sidebar fills
 * only from the desktop bridge, so outside the shell there is no way to see
 * the pill in place; this lets the showcase stand one up in the real sidebar. */
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

/* Versions already announced this launch. An update the user dismissed should
 * not reopen on every remount of the sidebar, but it does come back on the next
 * launch: an install that stays behind is the failure mode worth being pushy
 * about, and the dialog is one Escape away. */
const announced = new Set<string>();

/**
 * Sidebar footer CTA for a waiting update. It opens the changelog, where the new
 * version's notes sit above the restart (or, when the shell cannot install the
 * update itself, the download) CTA. Collapses to its icon with the sidebar, on
 * the same md breakpoint as the nav links.
 *
 * It also opens itself the first time each version is seen. Nothing else tells
 * the user they are running an old build, and a pill in a collapsed sidebar is
 * easy to never notice.
 */
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
