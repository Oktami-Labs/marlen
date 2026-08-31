import * as React from "react";
import { desktopBridge } from "@/lib/desktop";
import { subscribeRunNotifications } from "@/lib/serverEvents";

/**
 * Browser-tab fallback for run-completion desktop notifications: shows a
 * native Notification when a notify-flagged automation run finishes while
 * the tab is hidden (a visible tab already shows the run land in its live
 * feeds). It is disabled in the desktop shell because the main process uses
 * the same event stream. It is also disabled when the Notification API is
 * unavailable. AutomationsPanel requests permission; this hook only consumes
 * an existing grant.
 */
export function useRunNotifications(): void {
  React.useEffect(() => {
    if (desktopBridge() || !("Notification" in window)) return;
    return subscribeRunNotifications((notification) => {
      if (Notification.permission !== "granted" || !document.hidden) return;
      void new Notification(notification.automationName, { body: notification.summary });
    });
  }, []);
}
