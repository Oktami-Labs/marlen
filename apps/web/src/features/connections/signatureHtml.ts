import { api } from "@/lib/api";

/**
 * The markup and image plumbing behind the signature editor. A signature is
 * pasted from a mail client far more often than it is written, and a paste
 * arrives as layout markup plus images the clipboard only *points* at: a
 * webmail URL, a temp file, a `cid:` reference into the copied message. Left
 * alone those reach recipients as blocked or broken images, so every image is
 * resolved to bytes here, downscaled, and given a sane display width.
 */

/** Widest intrinsic image we keep: twice the widest sensible display width, so a logo stays crisp on a HiDPI screen. */
const MAX_INTRINSIC_WIDTH = 960;

/** Display width an image gets when it arrives wider and brings no size of its own. */
const DEFAULT_DISPLAY_WIDTH = 240;

/** Widths a signature image can be set to. An email body is ~600px, so wider than this only overflows. */
const MIN_IMAGE_WIDTH = 8;
const MAX_IMAGE_WIDTH = 640;

/** Per-image ceiling, enforced after downscaling. */
const MAX_IMAGE_BYTES = 300 * 1024;

/** Widths tried in turn until the encoded image fits MAX_IMAGE_BYTES. */
const DOWNSCALE_STEPS = [MAX_INTRINSIC_WIDTH, 720, 540, 400, 300];

/**
 * Whole-signature ceiling, under the route's schema cap with room for markup:
 * refusing here names the actual problem instead of letting the save come back
 * as a validation error.
 */
export const MAX_SIGNATURE_CHARS = 1_400_000;

/**
 * Resolve a pasted signature's own stylesheets onto the elements they match, so
 * that dropping the `<style>` blocks below does not drop the layout with them.
 * What a mail client puts in a stylesheet is exactly what makes a signature
 * look like itself: Outlook and Word keep the paragraph spacing there and
 * reference it by class (`p.MsoNormal {margin:0}`), and an email that arrives
 * without it falls back to the receiving client's paragraph margins, at twice
 * the height it was copied at.
 *
 * The CSS is parsed by the browser rather than by hand, in a sheet that is
 * never adopted anywhere, so nothing in the paste can style the app: invalid
 * rules and at-rules (@font-face, @page, @media) drop out on their own. Rules
 * apply in sheet order and the element's own inline style is appended last, so
 * it stays the winner. Sheet order is not the full cascade (a later `p` rule
 * would beat an earlier `p.x` here, where CSS lets specificity decide); the
 * sheets mail clients write qualify every selector the same way, so the
 * simplification has not been observed to matter.
 */
function inlineStylesheets(doc: Document): void {
  const byElement = new Map<Element, string[]>();
  for (const style of doc.querySelectorAll("style")) {
    const sheet = new CSSStyleSheet();
    try {
      // Word wraps its rules in an html comment, which is not CSS.
      sheet.replaceSync((style.textContent ?? "").replace(/<!--|-->/g, ""));
    } catch {
      // A sheet the parser refuses outright is lost; the paste itself is not.
      continue;
    }
    for (const rule of sheet.cssRules) {
      if (!(rule instanceof CSSStyleRule) || !rule.style.cssText) continue;
      for (const element of doc.querySelectorAll(rule.selectorText)) {
        byElement.set(element, [...(byElement.get(element) ?? []), rule.style.cssText]);
      }
    }
  }
  for (const [element, rules] of byElement) {
    const own = element.getAttribute("style");
    element.setAttribute("style", [...rules, own].filter(Boolean).join("; "));
  }
}

/**
 * Keeps useful mail-client formatting while dropping active/unsafe content and
 * Word/Outlook paste cruft: conditional comments, namespaced wrappers (<o:p>),
 * mso-* style props, and class names (dead weight once the stylesheet they
 * belong to has been resolved onto the elements themselves).
 */
export function sanitizeSignatureHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  inlineStylesheets(doc);
  doc.querySelectorAll("script,style,iframe,object,embed,form,input,button").forEach((el) => {
    el.remove();
  });
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_COMMENT);
  const comments: ChildNode[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode as ChildNode);
  for (const node of comments) node.remove();
  doc.querySelectorAll("*").forEach((el) => {
    if (el.tagName.includes(":")) {
      el.replaceWith(...el.childNodes);
      return;
    }
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (
        name.startsWith("on") ||
        name === "contenteditable" ||
        name === "class" ||
        name === "lang" ||
        ((name === "href" || name === "src") && value.startsWith("javascript:"))
      ) {
        el.removeAttribute(attr.name);
      }
    }
    const style = el.getAttribute("style");
    if (style) {
      const kept = style
        .split(";")
        .map((decl) => decl.trim())
        .filter((decl) => decl && !/^mso-/i.test(decl));
      if (kept.length > 0) el.setAttribute("style", kept.join("; "));
      else el.removeAttribute("style");
    }
  });
  return doc.body.innerHTML.trim();
}

/**
 * Pin an image's rendered width the way mail clients honor: the `width`
 * attribute for the ones that ignore CSS, the inline style for the rest, and no
 * `height`, so the aspect ratio follows the width instead of fighting it.
 */
export function setImageWidth(image: HTMLImageElement, width: number): number {
  const clamped = Math.round(Math.min(Math.max(width, MIN_IMAGE_WIDTH), MAX_IMAGE_WIDTH));
  image.setAttribute("width", String(clamped));
  image.removeAttribute("height");
  image.style.width = `${clamped}px`;
  image.style.height = "auto";
  image.style.maxWidth = "100%";
  return clamped;
}

/** Rendered width of an image already in the document, for seeding the size control. */
export function imageWidth(image: HTMLImageElement): number {
  return Math.round(image.getBoundingClientRect().width) || image.naturalWidth;
}

function dataUriBytes(dataUri: string): number {
  const base64 = dataUri.slice(dataUri.indexOf(",") + 1);
  return Math.round((base64.length * 3) / 4);
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image could not be decoded"));
    image.src = src;
  });
}

function scaleToDataUri(image: HTMLImageElement, width: number, mimeType: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round((image.naturalHeight / image.naturalWidth) * width));
  const context = canvas.getContext("2d");
  if (!context) return "";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  // PNG sources keep their format: a logo's transparency turns into a white box
  // the moment it becomes a JPEG.
  return canvas.toDataURL(mimeType === "image/png" ? "image/png" : "image/jpeg", 0.85);
}

/** One image's bytes, small enough to live in a signature, with its intrinsic width, or null when even the smallest step doesn't fit. */
async function normalizeImage(
  dataUri: string,
): Promise<{ src: string; naturalWidth: number } | null> {
  const image = await loadImage(dataUri).catch(() => null);
  if (!image?.naturalWidth) return null;
  const mimeType = dataUri.slice("data:".length, dataUri.indexOf(";"));
  if (image.naturalWidth <= MAX_INTRINSIC_WIDTH && dataUriBytes(dataUri) <= MAX_IMAGE_BYTES) {
    return { src: dataUri, naturalWidth: image.naturalWidth };
  }
  for (const step of DOWNSCALE_STEPS) {
    if (step > image.naturalWidth) continue;
    const scaled = scaleToDataUri(image, step, mimeType);
    if (scaled && dataUriBytes(scaled) <= MAX_IMAGE_BYTES) {
      return { src: scaled, naturalWidth: step };
    }
  }
  return null;
}

async function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("image could not be read"));
    reader.readAsDataURL(blob);
  });
}

/**
 * One pasted `src` as inline bytes, or null when they are out of reach. Two
 * kinds go through the server, because the page itself is not allowed to read
 * either: a remote http(s) image, whose cross-origin response is opaque to the
 * browser even when it can display it, and a `file:` path into the temp folder
 * Outlook and Word write a copied selection's images to. A `cid:` reference
 * points into the copied message and is reachable by nobody, so the caller
 * reports it.
 */
async function resolveImageSource(src: string): Promise<string | null> {
  if (src.startsWith("data:image/")) return src;
  if (src.startsWith("blob:") || src.startsWith("/")) {
    return fetch(src)
      .then((res) => res.blob())
      .then(blobToDataUri)
      .catch(() => null);
  }
  if (/^(https?|file):/i.test(src)) {
    return api
      .signatureImage(src)
      .then((res) => res.dataUri)
      .catch(() => null);
  }
  return null;
}

/**
 * Sizing for an image that just arrived. Geometry the copied signature carries
 * is left exactly as it is, keeping the layout is what pasting a signature
 * means, and a 1px spacer or a divider rule only survives untouched. Two
 * exceptions: a declared width wider than an email body is capped, and an image
 * that brings no geometry at all (a logo inserted from a file) gets a display
 * width so it doesn't land at its full pixel size.
 */
function applyArrivalWidth(image: HTMLImageElement, naturalWidth: number): void {
  const declaredWidth = Number.parseInt(image.getAttribute("width") ?? "", 10);
  if (declaredWidth > MAX_IMAGE_WIDTH) {
    setImageWidth(image, MAX_IMAGE_WIDTH);
    return;
  }
  const declaresGeometry =
    Number.isFinite(declaredWidth) ||
    Number.isFinite(Number.parseInt(image.getAttribute("height") ?? "", 10)) ||
    Boolean(image.style.width) ||
    Boolean(image.style.height);
  if (declaresGeometry || naturalWidth <= DEFAULT_DISPLAY_WIDTH) return;
  setImageWidth(image, DEFAULT_DISPLAY_WIDTH);
}

/**
 * Pasted signature markup, sanitized, with every image it references turned
 * into bytes it owns. `dropped` counts the images whose bytes could not be
 * reached, the paste still lands, and the caller says how many to re-add by
 * hand.
 */
export async function inlineSignatureHtml(
  html: string,
): Promise<{ html: string; dropped: number }> {
  const doc = new DOMParser().parseFromString(sanitizeSignatureHtml(html), "text/html");
  let dropped = 0;
  await Promise.all(
    [...doc.querySelectorAll("img")].map(async (image) => {
      const resolved = await resolveImageSource(image.getAttribute("src") ?? "");
      const normalized = resolved ? await normalizeImage(resolved) : null;
      if (!normalized) {
        image.remove();
        dropped++;
        return;
      }
      image.setAttribute("src", normalized.src);
      applyArrivalWidth(image, normalized.naturalWidth);
    }),
  );
  return { html: doc.body.innerHTML.trim(), dropped };
}

/** One image file (the toolbar's picker, or an image on the clipboard) as ready-to-insert markup, or null when it cannot be made to fit. */
export async function imageFileToHtml(file: File): Promise<string | null> {
  const normalized = await normalizeImage(await blobToDataUri(file));
  if (!normalized) return null;
  const image = document.createElement("img");
  image.setAttribute("src", normalized.src);
  applyArrivalWidth(image, normalized.naturalWidth);
  return image.outerHTML;
}
