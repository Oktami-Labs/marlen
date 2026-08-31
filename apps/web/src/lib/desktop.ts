/**
 * The bridge the desktop shell's preload script exposes as
 * window.marlenDesktop (apps/desktop/src/preload.ts). Absent in a plain
 * browser tab, callers feature-detect via desktopBridge().
 */

/**
 * Outcome of a user-initiated update check (mirrors UpdateCheckStatus in
 * apps/desktop/src/updater.ts). "downloading" means a newer release is being
 * fetched in the background, completion arrives via onUpdateState.
 * "unsupported" is an unpackaged dev run with no update feed.
 */
export type UpdateCheckStatus =
  | { status: "downloaded"; version: string }
  | { status: "downloading"; version: string }
  | { status: "manual"; version: string }
  | { status: "current" }
  | { status: "unsupported" }
  | { status: "error"; message: string };

/**
 * What the shell knows about the newest release (mirrors UpdateState in
 * apps/desktop/src/updater.ts). `manual` means a newer version exists that this
 * build cannot install itself, macOS refuses to swap an unsigned bundle, so
 * the only way forward is downloading the release by hand.
 */
export type UpdateState = {
  version: string | null;
  ready: boolean;
  manual: boolean;
};

/** Identity of the installed shell build: app version plus the host platform/arch. */
export type DesktopAppInfo = {
  version: string;
  /** Node's process.platform in the shell, "darwin", "win32", "linux". */
  platform: string;
  /** Node's process.arch in the shell, "arm64", "x64", …. */
  arch: string;
};

type DesktopBridge = {
  /** How the shell drew its title bar: "inset" = macOS floats the traffic
   *  lights over the web chrome (the web reserves their strip); "native" = a
   *  normal OS title bar the web ignores. */
  titleBar: "inset" | "native";
  /** Height in px the web reserves at the top for the "inset" title bar. */
  titleBarHeight: number;
  /** Report the resolved theme so the native window background tracks it. */
  setChromeTheme: (theme: "light" | "dark") => void;
  getAppInfo: () => Promise<DesktopAppInfo>;
  /** Translate the tray menu: the app language lives here, not in the shell. */
  setTrayLabels: (labels: { open: string; quit: string; background: string }) => void;
  /** What awaits the user: the count badges the app icon, the translated
   *  summary becomes the tray tooltip. */
  setWaiting: (count: number, summary: string) => void;
  /** Whether the OS starts Marlen at login. */
  getLaunchAtLogin: () => Promise<boolean>;
  /** Set the login item; resolves to what the OS actually reports afterwards. */
  setLaunchAtLogin: (enabled: boolean) => Promise<boolean>;
  /** What the shell currently knows about the newest release. */
  getUpdateState: () => Promise<UpdateState>;
  /** Check the release feed now; a found update starts downloading in the background. */
  checkForUpdates: () => Promise<UpdateCheckStatus>;
  /** Fires whenever the shell learns something new about the newest release; returns unsubscribe. */
  onUpdateState: (callback: (state: UpdateState) => void) => () => void;
  /** Quit and relaunch into the downloaded update. */
  installUpdate: () => void;
};

export function desktopBridge(): DesktopBridge | undefined {
  return (window as Window & { marlenDesktop?: DesktopBridge }).marlenDesktop;
}

/** The inset (macOS) title-bar reservation, or null in a browser tab / on a
 *  platform with a native bar, the only case the web reserves top space for. */
export function insetTitleBar(): { height: number } | null {
  const bridge = desktopBridge();
  return bridge?.titleBar === "inset" ? { height: bridge.titleBarHeight } : null;
}
