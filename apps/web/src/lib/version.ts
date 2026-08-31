import { CHANGELOG } from "@marlen/shared";
import * as React from "react";
import { desktopBridge } from "@/lib/desktop";

/**
 * The version actually running. In the desktop app the shell's own build number
 * is authoritative. The bundle can be any age, and an install that never took
 * an update is exactly the case this is here to expose. A browser tab has no
 * shell, so it falls back to the newest changelog entry compiled into the
 * bundle it was served.
 *
 * Support reads this off a screenshot, so it must never show a version the user
 * is not on: the fallback applies only where no shell can be asked.
 */
export function useAppVersion(): string | null {
  const bundled = CHANGELOG[0]?.version ?? null;
  const [version, setVersion] = React.useState<string | null>(desktopBridge() ? null : bundled);

  React.useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge) return;
    bridge.getAppInfo().then(
      (info) => setVersion(info.version),
      () => setVersion(bundled),
    );
  }, [bundled]);

  return version;
}
