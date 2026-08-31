import path from "node:path";
import { app, Menu, nativeImage, Tray } from "electron";

export interface TrayLabels {
  open: string;
  quit: string;
  background: string;
}

let tray: Tray | null = null;
let labels: TrayLabels = {
  open: "Marlene öffnen",
  quit: "Marlene beenden",
  background: "Marlene läuft weiter und führt Ihre Automatisierungen aus.",
};
let waiting = "";
let openWindow: () => void = () => {};

export function trayPlatform(): boolean {
  return process.platform !== "darwin";
}

export function trayActive(): boolean {
  return tray !== null;
}

function render(): void {
  if (!tray) return;
  // The tooltip is where the pending count lives on Windows, whose taskbar has
  // no badge to set (app.setBadgeCount is macOS and Linux).
  tray.setToolTip(waiting ? `Marlene — ${waiting}` : "Marlene");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: labels.open, click: () => openWindow() },
      { type: "separator" },
      { label: labels.quit, click: () => app.quit() },
    ]),
  );
}

export function startTray(opts: { onOpen: () => void }): void {
  if (!trayPlatform() || tray) return;
  openWindow = opts.onOpen;
  try {
    const icon = nativeImage
      .createFromPath(path.join(__dirname, "resources", "icon.png"))
      .resize({ width: 16, height: 16 });
    tray = new Tray(icon);
  } catch {
    // No system tray (some Linux desktops). Without one the app must keep
    // quitting with its last window, which trayActive() reports.
    return;
  }
  tray.on("click", () => openWindow());
  render();
}

export function setTrayLabels(next: TrayLabels): void {
  labels = next;
  render();
}

export function setTrayWaiting(summary: string): void {
  if (summary === waiting) return;
  waiting = summary;
  render();
}

export function backgroundHint(): string {
  return labels.background;
}

export function stopTray(): void {
  tray?.destroy();
  tray = null;
}
