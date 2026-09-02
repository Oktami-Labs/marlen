import {
  app,
  type BrowserWindowConstructorOptions,
  Menu,
  type MenuItemConstructorOptions,
  nativeTheme,
} from "electron";
import { titleBarMode } from "./titlebar";

// Keep these in sync with the web sidebar colors to avoid a launch flash.
const CHROME_LIGHT = "#f2f2f2";
const CHROME_DARK = "#0d0d0d";

export function chromeBackground(dark: boolean): string {
  return dark ? CHROME_DARK : CHROME_LIGHT;
}

export function initialBackground(): string {
  return chromeBackground(nativeTheme.shouldUseDarkColors);
}

/** Inline startup page with time-based progress that never reaches completion. */
export function splashUrl(): string {
  const dark = nativeTheme.shouldUseDarkColors;
  const track = dark ? "#27272a" : "#e4e4e7";
  const fill = dark ? "#a1a1aa" : "#52525b";
  const notes = [
    [8_000, "Der lokale Server startet."],
    [
      25_000,
      "Beim ersten Start nach einer Installation oder einem Update prüft das Betriebssystem alle Dateien der App. Das dauert einmalig länger.",
    ],
    [
      60_000,
      "Das dauert ungewöhnlich lange. Marlene protokolliert den Start in logs/marlen.log im Datenordner.",
    ],
  ] as const;
  const html =
    `<!doctype html><title>Marlene</title><style>` +
    `html,body{height:100%;margin:0;background:${chromeBackground(dark)}}` +
    `body{display:flex;align-items:center;justify-content:center;color:${fill};` +
    `font:400 13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}` +
    `main{width:264px;text-align:center}` +
    `#t{height:2px;border-radius:1px;background:${track};overflow:hidden}` +
    `#f{height:100%;width:0;background:${fill}}` +
    `p{margin:14px 0 0}#n{margin-top:6px;font-size:12px;opacity:.65}` +
    `</style><main><div id="t"><div id="f"></div></div>` +
    `<p>Marlene wird gestartet</p><p id="n"></p></main><script>` +
    `var p=0,s=Date.now(),n=${JSON.stringify(notes)};` +
    `setInterval(function(){` +
    `p+=(92-p)*0.06;document.getElementById("f").style.width=p.toFixed(1)+"%";` +
    `var e=Date.now()-s,m="";for(var i=0;i<n.length;i++){if(e>=n[i][0])m=n[i][1]}` +
    `var d=document.getElementById("n");if(d.textContent!==m)d.textContent=m;` +
    `},80)</script>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

export function windowChrome(): BrowserWindowConstructorOptions {
  if (titleBarMode() === "inset") {
    return { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 16, y: 14 } };
  }
  return {};
}

export function installAppMenu(): void {
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
    return;
  }
  const view: MenuItemConstructorOptions[] = [
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" },
    { type: "separator" },
    { role: "togglefullscreen" },
  ];
  if (!app.isPackaged) {
    view.unshift(
      { role: "reload" },
      { role: "forceReload" },
      { role: "toggleDevTools" },
      { type: "separator" },
    );
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "appMenu" },
      { role: "editMenu" },
      { label: "View", submenu: view },
      { role: "windowMenu" },
    ]),
  );
}
