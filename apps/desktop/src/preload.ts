import { contextBridge, ipcRenderer } from "electron";
import { TITLEBAR_HEIGHT, titleBarMode } from "./titlebar";
import type { UpdateCheckStatus, UpdateState } from "./updater";

/**
 * window.marlenDesktop — the web app's only view of the shell: the update flow
 * plus the title-bar contract (how the bar was drawn, so the web reserves the
 * matching strip). Mirrored by the DesktopBridge type in apps/web/src/lib/desktop.ts.
 */
contextBridge.exposeInMainWorld("marlenDesktop", {
  titleBar: titleBarMode(),
  titleBarHeight: TITLEBAR_HEIGHT,
  setChromeTheme: (theme: "light" | "dark"): void => {
    ipcRenderer.send("marlen:set-chrome-theme", theme);
  },
  getAppInfo: (): Promise<{ version: string; platform: string; arch: string }> =>
    ipcRenderer.invoke("marlen:get-app-info") as Promise<{
      version: string;
      platform: string;
      arch: string;
    }>,
  setTrayLabels: (labels: { open: string; quit: string; background: string }): void => {
    ipcRenderer.send("marlen:set-tray-labels", labels);
  },
  setWaiting: (count: number, summary: string): void => {
    ipcRenderer.send("marlen:set-waiting", count, summary);
  },
  getLaunchAtLogin: (): Promise<boolean> =>
    ipcRenderer.invoke("marlen:get-launch-at-login") as Promise<boolean>,
  setLaunchAtLogin: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke("marlen:set-launch-at-login", enabled) as Promise<boolean>,
  getUpdateState: (): Promise<UpdateState> =>
    ipcRenderer.invoke("marlen:get-update-state") as Promise<UpdateState>,
  checkForUpdates: (): Promise<UpdateCheckStatus> =>
    ipcRenderer.invoke("marlen:check-for-updates") as Promise<UpdateCheckStatus>,
  onUpdateState: (callback: (state: UpdateState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: UpdateState) => callback(state);
    ipcRenderer.on("marlen:update-state", listener);
    return () => {
      ipcRenderer.removeListener("marlen:update-state", listener);
    };
  },
  installUpdate: (): void => {
    ipcRenderer.send("marlen:install-update");
  },
});
