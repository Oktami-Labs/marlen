import log from "electron-log/main";

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1_000;

export type UpdateCheckStatus =
  | { status: "downloaded"; version: string }
  | { status: "downloading"; version: string }
  | { status: "manual"; version: string }
  | { status: "current" }
  | { status: "unsupported" }
  | { status: "error"; message: string };

export interface UpdateState {
  version: string | null;
  ready: boolean;
  manual: boolean;
}

const state: UpdateState = { version: null, ready: false, manual: false };

export function updateState(): UpdateState {
  return { ...state };
}

/** `autoUpdater` is a CommonJS getter that dynamic import cannot detect. */
function loadUpdater(): typeof import("electron-updater") {
  return require("electron-updater") as typeof import("electron-updater");
}

export function startUpdater(onChange: (state: UpdateState) => void): void {
  const { autoUpdater } = loadUpdater();
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  const publish = () => onChange(updateState());

  autoUpdater.on("update-available", (info) => {
    state.version = info.version;
    publish();
  });
  autoUpdater.on("update-downloaded", (info) => {
    state.version = info.version;
    state.ready = true;
    state.manual = false;
    publish();
  });
  // A failure after discovery means the release requires manual installation.
  autoUpdater.on("error", (error) => {
    log.warn(`updater: ${error.message}`);
    if (state.version && !state.ready) {
      state.manual = true;
      publish();
    }
  });

  const check = () =>
    autoUpdater.checkForUpdates().catch((error: unknown) => {
      log.warn(`updater check failed: ${String(error)}`);
    });
  void check();
  setInterval(check, CHECK_INTERVAL_MS);
}

export async function checkForUpdatesNow(): Promise<UpdateCheckStatus> {
  if (state.version && state.ready) return { status: "downloaded", version: state.version };
  if (state.version && state.manual) return { status: "manual", version: state.version };
  const { autoUpdater } = loadUpdater();
  try {
    const result = await autoUpdater.checkForUpdates();
    if (result?.isUpdateAvailable) {
      const version = result.updateInfo.version;
      return state.manual ? { status: "manual", version } : { status: "downloading", version };
    }
    return { status: "current" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`updater manual check failed: ${message}`);
    return { status: "error", message };
  }
}

export function installUpdate(): void {
  loadUpdater().autoUpdater.quitAndInstall();
}
