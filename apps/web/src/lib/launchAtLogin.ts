import * as React from "react";
import { desktopBridge } from "@/lib/desktop";

const listeners = new Set<(enabled: boolean) => void>();

export async function applyLaunchAtLoginPreference(enabled: boolean): Promise<boolean | null> {
  const bridge = desktopBridge();
  if (!bridge) return null;
  const saved = await bridge.setLaunchAtLogin(enabled);
  for (const listener of listeners) listener(saved);
  return saved;
}

export function useLaunchAtLoginPreference() {
  const bridge = desktopBridge();
  const [enabled, setEnabled] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    if (!bridge) return;
    bridge
      .getLaunchAtLogin()
      .then(setEnabled)
      .catch(() => setEnabled(false));
  }, [bridge]);

  React.useEffect(() => {
    listeners.add(setEnabled);
    return () => {
      listeners.delete(setEnabled);
    };
  }, []);

  return { supported: Boolean(bridge), enabled, apply: applyLaunchAtLoginPreference } as const;
}
