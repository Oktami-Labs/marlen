import log from "electron-log/main";

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1_000;

/**
 * Outcome of a user-initiated check. "downloading" = a newer release exists and
 * is being fetched (completion arrives via the update-state event). "manual" =
 * a newer release exists but this build cannot install it (see UpdateState).
 * "unsupported" = a dev run, no update feed baked into an unpackaged app.
 */
export type UpdateCheckStatus =
  | { status: "downloaded"; version: string }
  | { status: "downloading"; version: string }
  | { status: "manual"; version: string }
  | { status: "current" }
  | { status: "unsupported" }
  | { status: "error"; message: string };

/**
 * What the shell knows about the newest release.
 *
 * `manual` is the state the update feed cannot resolve on its own: macOS
 * refuses to swap a bundle that is unsigned or only ad-hoc signed, which is
 * every build this project ships today (release.yml sets
 * CSC_IDENTITY_AUTO_DISCOVERY=false), so staging the download fails there every
 * time. Reporting it is the whole point — an install that silently retries
 * forever sits versions behind while the user believes they are current, and
 * the only way out is downloading the release by hand.
 */
export interface UpdateState {
  /** Newest version the feed offers, or null while no newer release is known. */
  version: string | null;
  /** Downloaded and staged: installUpdate() will relaunch into it. */
  ready: boolean;
  /** The shell cannot install it; the user has to fetch the release themselves. */
  manual: boolean;
}

const state: UpdateState = { version: null, ready: false, manual: false };

export function updateState(): UpdateState {
  return { ...state };
}

/**
 * electron-updater loads lazily: it only exists in a packaged app's
 * node_modules, and only packaged runs get here. Must load via CJS require (the
 * shell bundle's format): its `autoUpdater` is a getter on module.exports,
 * which `import()`'s named-export detection can't see.
 */
function loadUpdater(): typeof import("electron-updater") {
  return require("electron-updater") as typeof import("electron-updater");
}

export function startUpdater(onChange: (state: UpdateState) => void): void {
  const { autoUpdater } = loadUpdater();
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  const publish = () => onChange(updateState());

  // A newer release exists. Announced before the download so the user hears
  // about it even when staging never completes.
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
  // Updating is best-effort: an unreachable feed can't take the app down. But a
  // failure once the feed has already named a newer version means this build
  // cannot install that version, which is the difference between "up to date"
  // and "stuck", so it becomes visible instead of only reaching the log.
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
