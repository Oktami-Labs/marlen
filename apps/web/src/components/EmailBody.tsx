import { ImageOff } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { openExternal } from "@/lib/utils";

/** Tallest an inline message renders; beyond this its own document scrolls. */
const MAX_HEIGHT = 560;

/** Height the frame holds before it has measured itself. */
const INITIAL_HEIGHT = 96;

const REMOTE_IMAGE = /<img[^>]+src=["']https?:/i;

/**
 * The frame's own document styles: the message paints on white whatever the
 * app theme is, because email HTML is authored against a light page and states
 * only the colors it wants to change.
 */
const FRAME_STYLE = `
:root { color-scheme: light }
html, body { margin: 0; padding: 0 }
body {
  background: #fff;
  color: #1b1b1f;
  font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  overflow-wrap: break-word;
}
/* No frame padding: the message lines up with the header above it, and on a
   light theme its paper and the panel behind it are the same white. */
body > :first-child { margin-top: 0 }
body > :last-child { margin-bottom: 0 }
img { max-width: 100%; height: auto }
blockquote { margin: 0 0 0 8px; padding-left: 12px; border-left: 2px solid #e4e4e9; color: #56565e }
pre { white-space: pre-wrap }
.marlen-quote { display: none }
.marlen-quote.open { display: block }
.marlen-quote-toggle {
  margin: 4px 0;
  padding: 1px 8px;
  border: 0;
  border-radius: 9px;
  background: #ececf1;
  color: #56565e;
  font: inherit;
  line-height: 1.2;
  cursor: pointer;
}
`;

/**
 * Runs inside the sandbox, where it can reach nothing but its own document:
 * reports the content height, collapses the quoted history behind a toggle,
 * and hands link clicks to the app rather than navigating the frame.
 */
const FRAME_SCRIPT = `(function () {
  var send = function (kind, value) { parent.postMessage({ marlenEmail: kind, value: value }, "*") }
  var report = function () { send("height", Math.ceil(document.documentElement.scrollHeight)) }

  var anchor = document.querySelector('.gmail_quote, blockquote[type="cite"], .moz-cite-prefix, #divRplyFwdMsg')
  if (anchor) {
    var top = anchor
    while (top.parentNode && top.parentNode !== document.body) top = top.parentNode
    var before = ""
    for (var node = top.previousSibling; node; node = node.previousSibling) before += node.textContent || ""
    // A message that is nothing but quoted history keeps it: collapsing would leave an empty body.
    if (before.trim() && top.parentNode === document.body) {
      var quoted = document.createElement("div")
      quoted.className = "marlen-quote"
      document.body.insertBefore(quoted, top)
      while (quoted.nextSibling) quoted.appendChild(quoted.nextSibling)
      var toggle = document.createElement("button")
      toggle.type = "button"
      toggle.className = "marlen-quote-toggle"
      toggle.textContent = "\\u2022\\u2022\\u2022"
      toggle.title = __QUOTE_LABEL__
      toggle.addEventListener("click", function () { quoted.classList.toggle("open"); report() })
      document.body.insertBefore(toggle, quoted)
    }
  }

  document.addEventListener("click", function (event) {
    var el = event.target
    while (el && el.tagName !== "A") el = el.parentElement
    if (!el) return
    event.preventDefault()
    if (/^(https?|mailto):/i.test(el.href)) send("open", el.href)
  })

  new ResizeObserver(report).observe(document.documentElement)
  window.addEventListener("load", report)
  report()
})()`;

/**
 * The message as one self-contained document. Its CSP is the boundary the
 * viewer rests on: no scripts but the nonced one below, no network at all, and
 * remote images only once the reader asks for them. The frame carries no
 * allow-same-origin, so the script runs in an opaque origin that cannot reach
 * the app, its storage, or the local API.
 */
function frameDocument(html: string, remoteImages: boolean, quoteLabel: string): string {
  const nonce = crypto.randomUUID();
  const policy = [
    "default-src 'none'",
    `img-src data:${remoteImages ? " https:" : ""}`,
    "style-src 'unsafe-inline'",
    `script-src 'nonce-${nonce}'`,
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
  const script = FRAME_SCRIPT.replace("__QUOTE_LABEL__", JSON.stringify(quoteLabel));
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<style>${FRAME_STYLE}</style></head>
<body>${html}<script nonce="${nonce}">${script}</script></body></html>`;
}

/**
 * A received message's HTML, rendered as the sender wrote it. The html is
 * sanitized server-side and rendered here in a sandboxed frame that sizes
 * itself to its content.
 */
export function EmailBody({ html }: { html: string }) {
  const { t } = useTranslation();
  const frame = React.useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = React.useState(0);
  const [remoteImages, setRemoteImages] = React.useState(false);

  const srcDoc = React.useMemo(
    () => frameDocument(html, remoteImages, t("emailBody.showQuoted")),
    [html, remoteImages, t],
  );

  React.useEffect(() => {
    // Anything the frame posts is untrusted input: identify the sender by its
    // window, then narrow, before acting on it.
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const message = event.data as { marlenEmail?: unknown; value?: unknown } | null;
      if (message?.marlenEmail === "height" && typeof message.value === "number") {
        setHeight(Math.min(message.value, MAX_HEIGHT));
      } else if (message?.marlenEmail === "open" && typeof message.value === "string") {
        openExternal(message.value);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div className="flex flex-col gap-1.5">
      {!remoteImages && REMOTE_IMAGE.test(html) && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ImageOff className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{t("emailBody.imagesBlocked")}</span>
          <Button variant="ghost" size="sm" onClick={() => setRemoteImages(true)}>
            {t("emailBody.loadImages")}
          </Button>
        </div>
      )}
      <iframe
        ref={frame}
        title={t("emailBody.title")}
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        style={{ height: height || INITIAL_HEIGHT }}
        className="w-full rounded-[--radius] bg-white"
      />
    </div>
  );
}
