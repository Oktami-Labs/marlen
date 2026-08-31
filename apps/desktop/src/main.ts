import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Notification,
  session,
  shell,
  systemPreferences,
  type UtilityProcess,
  utilityProcess,
  type WebContents,
} from "electron";
import log from "electron-log/main";
import {
  chromeBackground,
  initialBackground,
  installAppMenu,
  splashUrl,
  windowChrome,
} from "./chrome";
import { startNotifications, stopNotifications } from "./notifications";
import {
  backgroundHint,
  setTrayLabels,
  setTrayWaiting,
  startTray,
  stopTray,
  type TrayLabels,
  trayActive,
} from "./tray";
import {
  checkForUpdatesNow,
  installUpdate,
  startUpdater,
  type UpdateCheckStatus,
  updateState,
} from "./updater";

/** A stable first choice keeps renderer localStorage on the same origin. */
const BASE_PORT = 43117;
const PORT_SCAN_RANGE = 20;
/** Repeated exits inside this window exhaust the restart budget. */
const RESTART_WINDOW_MS = 60_000;
const RESTART_BACKOFF_MS = [500, 1_000, 2_000, 5_000, 10_000];
// Generous: the first launch after install (or an update) on Windows can spend
// minutes in Defender's on-access scan of the unpacked node_modules before the
// server even starts booting. The splash window keeps the wait visible.
const SERVER_READY_TIMEOUT_MS = 180_000;

let serverProcess: UtilityProcess | null = null;
let serverPort: number | null = null;
let quitting = false;
let recentExits: number[] = [];
let restartTimer: NodeJS.Timeout | null = null;

const smokeMode = Boolean(process.env.MARLEN_DESKTOP_SMOKE);

function fatal(message: string): void {
  log.error(message);
  if (smokeMode) {
    app.exit(1);
    return;
  }
  dialog.showErrorBox("Marlene", message);
  app.quit();
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolveProbe) => {
    const probe = net.createServer();
    probe.once("error", () => resolveProbe(false));
    probe.once("listening", () => probe.close(() => resolveProbe(true)));
    probe.listen(port, "127.0.0.1");
  });
}

async function findFreePort(): Promise<number> {
  for (let port = BASE_PORT; port < BASE_PORT + PORT_SCAN_RANGE; port++) {
    if (await portFree(port)) return port;
  }
  throw new Error(`no free port in ${BASE_PORT}-${BASE_PORT + PORT_SCAN_RANGE - 1}`);
}

function serverEnv(port: number): Record<string, string> {
  const dataRoot = app.getPath("userData");
  mkdirSync(dataRoot, { recursive: true });
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) merged[key] = value;
  }
  return {
    ...merged,
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: String(port),
    MARLEN_APP_VERSION: app.getVersion(),
    DATABASE_PATH: path.join(dataRoot, "data", "marlen.db"),
    // Mutable agent data belongs under Electron's update-safe userData folder.
    AGENT_HOME_PATH: path.join(dataRoot, "agent-home"),
    // Source paths consumed by the server's data migration.
    LIBRARY_PATH: path.join(dataRoot, "library"),
    SKILLS_PATH: path.join(dataRoot, "skills"),
    WHATSAPP_AUTH_PATH: path.join(dataRoot, "data", "whatsapp-auth"),
    LOG_FILE: path.join(dataRoot, "logs", "marlen.log"),
    WEB_DIST_PATH: path.join(__dirname, "web"),
  };
}

function startServer(port: number): void {
  const entry = path.join(__dirname, "server", "index.mjs");
  const child = utilityProcess.fork(entry, [], {
    env: serverEnv(port),
    stdio: "inherit",
    serviceName: "marlen-server",
  });
  child.once("exit", (code) => {
    serverProcess = null;
    if (quitting) return;
    const now = Date.now();
    recentExits = recentExits.filter((at) => now - at < RESTART_WINDOW_MS);
    const backoff = RESTART_BACKOFF_MS[recentExits.length];
    if (backoff === undefined) {
      fatal(
        `The local Marlene server keeps stopping (code ${code}). Check the logs and reopen the app.`,
      );
      return;
    }
    recentExits.push(now);
    log.warn(`server exited (code ${code}); restarting in ${backoff}ms`);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (!quitting) startServer(port);
    }, backoff);
  });
  serverProcess = child;
}

function serverResponding(port: number): Promise<boolean> {
  return new Promise((resolvePoll) => {
    const request = http.get({ host: "127.0.0.1", port, path: "/", timeout: 1_000 }, (response) => {
      response.resume();
      resolvePoll(true);
    });
    request.on("error", () => resolvePoll(false));
    request.on("timeout", () => {
      request.destroy();
      resolvePoll(false);
    });
  });
}

async function waitForServer(port: number): Promise<void> {
  const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (serverProcess === null && restartTimer === null) {
      throw new Error("server exited during startup");
    }
    if (await serverResponding(port)) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`server not reachable on port ${port} within ${SERVER_READY_TIMEOUT_MS}ms`);
}

/** Open new windows in the system browser, where sign-in cookies live. */
function installLinkPolicy(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
}

/** macOS microphone access requires both Electron and system consent. */
function installPermissionPolicy(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const wantsMicrophone =
      permission === "media" &&
      "mediaTypes" in details &&
      (details.mediaTypes ?? []).includes("audio");
    if (!wantsMicrophone || process.platform !== "darwin") {
      callback(true);
      return;
    }
    void systemPreferences.askForMediaAccess("microphone").then(callback);
  });
}

function createWindow(port: number, booting = false): BrowserWindow {
  const origin = `http://127.0.0.1:${port}`;
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: initialBackground(),
    ...windowChrome(),
    webPreferences: { preload: path.join(__dirname, "preload.cjs") },
  });
  installLinkPolicy(window.webContents);
  // Keep external navigation out of the privileged app window.
  window.webContents.on("will-navigate", (event, url) => {
    let external: boolean;
    try {
      external = new URL(url).origin !== origin;
    } catch {
      external = true;
    }
    if (!external) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) void shell.openExternal(url);
  });
  void window.loadURL(booting ? splashUrl() : `${origin}/`);
  if (smokeMode) {
    window.webContents.on("did-finish-load", () => {
      if (!window.webContents.getURL().startsWith(origin)) return;
      log.info("desktop smoke: window loaded");
      app.quit();
    });
  }
  return window;
}

function focusOrCreateWindow(): void {
  const [window] = BrowserWindow.getAllWindows();
  if (window) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  } else if (serverPort !== null) {
    createWindow(serverPort);
  }
}

/** Show the background-running hint once per install. */
function noteBackgroundRunning(): void {
  const marker = path.join(app.getPath("userData"), "background-hint-shown");
  if (existsSync(marker)) return;
  try {
    writeFileSync(marker, "");
  } catch (error) {
    log.warn(`writing the background hint marker failed: ${String(error)}`);
  }
  if (!Notification.isSupported()) return;
  new Notification({ title: "Marlene", body: backgroundHint() }).show();
}

function startsHidden(): boolean {
  return process.argv.includes("--hidden") || app.getLoginItemSettings().wasOpenedAsHidden;
}

// Preserve the existing data directory when Electron's app name changes.
function migrateUserData(): void {
  const current = app.getPath("userData");
  const legacy = path.join(app.getPath("appData"), "Trailin");
  if (legacy === current || existsSync(current) || !existsSync(legacy)) return;
  try {
    renameSync(legacy, current);
    log.info(`migrated userData from ${legacy}`);
  } catch (error) {
    log.warn(`userData rename failed, using legacy folder: ${String(error)}`);
    app.setPath("userData", legacy);
  }
}
migrateUserData();

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    focusOrCreateWindow();
  });

  app.on("window-all-closed", () => {
    // Stay alive only where the dock or tray can reopen the app.
    if (process.platform === "darwin") return;
    if (!trayActive()) {
      app.quit();
      return;
    }
    noteBackgroundRunning();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverPort !== null) {
      createWindow(serverPort);
    }
  });

  app.on("before-quit", () => {
    quitting = true;
    stopNotifications();
    stopTray();
    if (restartTimer) clearTimeout(restartTimer);
    serverProcess?.kill();
  });

  ipcMain.on("marlen:set-chrome-theme", (event, theme: unknown) => {
    if (theme !== "light" && theme !== "dark") return;
    BrowserWindow.fromWebContents(event.sender)?.setBackgroundColor(
      chromeBackground(theme === "dark"),
    );
  });

  ipcMain.on("marlen:set-tray-labels", (_event, next: unknown) => {
    const labels = next as Partial<TrayLabels> | null;
    if (!labels?.open || !labels.quit || !labels.background) return;
    setTrayLabels({ open: labels.open, quit: labels.quit, background: labels.background });
  });

  ipcMain.on("marlen:set-waiting", (_event, count: unknown, summary: unknown) => {
    const waiting = typeof count === "number" && count > 0 ? Math.floor(count) : 0;
    // No-op on Windows, whose taskbar has no badge; the tooltip carries it there.
    app.setBadgeCount(waiting);
    setTrayWaiting(waiting > 0 && typeof summary === "string" ? summary : "");
  });

  ipcMain.handle("marlen:get-launch-at-login", () => app.getLoginItemSettings().openAtLogin);
  ipcMain.handle("marlen:set-launch-at-login", (_event, enabled: unknown) => {
    const openAtLogin = enabled === true;
    app.setLoginItemSettings({
      openAtLogin,
      openAsHidden: openAtLogin,
      args: openAtLogin ? ["--hidden"] : [],
    });
    return app.getLoginItemSettings().openAtLogin;
  });

  ipcMain.handle("marlen:get-update-state", () => updateState());
  ipcMain.handle("marlen:get-app-info", () => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
  }));
  ipcMain.handle("marlen:check-for-updates", (): Promise<UpdateCheckStatus> | UpdateCheckStatus =>
    app.isPackaged ? checkForUpdatesNow() : { status: "unsupported" },
  );
  ipcMain.on("marlen:install-update", () => installUpdate());

  void app.whenReady().then(async () => {
    installAppMenu();
    installPermissionPolicy();
    try {
      const port = await findFreePort();
      serverPort = port;
      startServer(port);
      startTray({ onOpen: focusOrCreateWindow });
      // Open the splash before waiting for the server.
      const window = startsHidden() ? null : createWindow(port, true);
      await waitForServer(port);
      if (window && !window.isDestroyed()) void window.loadURL(`http://127.0.0.1:${port}/`);
      startNotifications(port, { onOpenRequest: focusOrCreateWindow });
      if (app.isPackaged) {
        startUpdater((state) => {
          for (const window of BrowserWindow.getAllWindows()) {
            window.webContents.send("marlen:update-state", state);
          }
        });
      }
    } catch (error) {
      if (quitting) return;
      fatal(`Marlene failed to start: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}
