import { lookup } from "node:dns/promises";
import { readFile, realpath } from "node:fs/promises";
import { isIP } from "node:net";
import { homedir, tmpdir } from "node:os";
import { extname, isAbsolute, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { badRequest, upstreamError } from "../core/errors.js";
import { moduleLogger } from "../core/logger.js";

/**
 * Reading the images a pasted signature points at, so the signature carries its
 * own bytes. The browser cannot perform either source handoff:
 * a webmail copy references its logo by URL (googleusercontent, a company web
 * server) and a cross-origin response is opaque to canvas and to fetch; a copy
 * out of Outlook or Word on the desktop references the temp files it wrote for
 * the clipboard, and a page may not read file: urls at all.
 */

const log = moduleLogger("signature-image");

/** Formats a mail client renders inline. SVG is excluded: script-bearing markup that no client honors in a signature anyway. */
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Raw ceiling before the browser downscales; a signature logo is orders of magnitude smaller. */
const MAX_BYTES = 4 * 1024 * 1024;

const FETCH_TIMEOUT_MS = 8000;

/** A logo URL commonly redirects (http to https, a CDN hop); every hop is re-checked before it is followed. */
const MAX_REDIRECTS = 3;

/**
 * Address blocks that are not "somewhere on the web": loopback, link-local
 * (which includes the cloud metadata endpoints), private ranges, and the
 * unspecified address. Pasted markup is attacker-supplyable in the sense that
 * whoever wrote the copied email chose the URLs, so this fetch must not become
 * a way to reach the machine's own network.
 */
function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const ip = address.toLowerCase();
    return (
      ip === "::" ||
      ip === "::1" ||
      ip.startsWith("fe80:") ||
      ip.startsWith("fc") ||
      ip.startsWith("fd") ||
      // IPv4-mapped (::ffff:127.0.0.1) resolves to the v4 address it names.
      (ip.startsWith("::ffff:") && isPrivateAddress(ip.slice("::ffff:".length)))
    );
  }
  const [a = 0, b = 0] = address.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

async function assertPublicHost(hostname: string): Promise<void> {
  const literal = hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(literal)
    ? [literal]
    : (await lookup(literal, { all: true }).catch(() => [])).map((entry) => entry.address);
  if (addresses.length === 0) throw badRequest("that image address could not be resolved");
  if (addresses.some(isPrivateAddress)) throw badRequest("that image address is not reachable");
}

/** Extensions a clipboard temp image carries. The bytes are sniffed regardless; this only keeps the door narrow. */
const IMAGE_EXTENSIONS = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
]);

/** The type the leading bytes actually declare, so a path that merely ends in .png cannot pass something else off as an image. */
function sniffImageType(bytes: Buffer): string | undefined {
  const head = bytes.subarray(0, 12);
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.subarray(0, 3).toString("latin1") === "GIF") return "image/gif";
  if (
    head.subarray(0, 4).toString("latin1") === "RIFF" &&
    head.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }
  return undefined;
}

/** True when `path` really sits inside `root`, both already resolved of links. */
function contains(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * True when `path` is in a folder a copying app writes clipboard images to.
 * The process temp dir covers Windows (%TEMP%) and every unsandboxed app; a
 * sandboxed macOS app (Outlook, Word) has its temp dir redirected into its own
 * container, ~/Library/Containers/<bundle id>/Data/tmp, which lies outside
 * tmpdir() entirely. `path` is already resolved of links, so neither shape can
 * be entered through a symlink from somewhere else.
 */
function isClipboardTemp(path: string, tempRoot: string, home: string): boolean {
  if (contains(tempRoot, path)) return true;
  if (process.platform !== "darwin") return false;
  const segments = relative(home, path).split(sep);
  return (
    segments.length > 5 &&
    segments[0] === "Library" &&
    segments[1] === "Containers" &&
    segments[3] === "Data" &&
    segments[4] === "tmp"
  );
}

/**
 * One image out of the clipboard's temp folder. Outlook and Word write the
 * images of a copied selection to disk and reference them from the clipboard's
 * html by local path, so a signature pasted from the desktop app arrives
 * pointing at files the page itself may not open. Only that handoff is served:
 * a link-resolved path inside the OS temp directory, an image extension, and
 * bytes that are that image. Anything else is a request to read a local file,
 * which this is not.
 */
async function readClipboardImage(url: URL): Promise<string> {
  let path: string;
  try {
    path = fileURLToPath(url);
  } catch {
    throw badRequest("that is not an image file");
  }
  if (!IMAGE_EXTENSIONS.has(extname(path).toLowerCase())) {
    throw badRequest("that file is not a png, jpeg, gif or webp image");
  }
  // Resolved before it is judged: a link inside the temp folder must not be a
  // way out of it.
  const resolved = await realpath(path).catch(() => null);
  const tempRoot = await realpath(tmpdir()).catch(() => tmpdir());
  const home = await realpath(homedir()).catch(() => homedir());
  if (!resolved) throw badRequest("that image file could not be read");
  if (!isClipboardTemp(resolved, tempRoot, home)) {
    // Logged because the paths a mail client uses vary per platform and
    // version, and a refusal reaches the user only as "could not be copied".
    log.debug({ path: resolved }, "signature image refused: outside the clipboard temp folders");
    throw badRequest("only an image the clipboard left in the temp folder can be read");
  }

  const bytes = await readFile(resolved).catch(() => null);
  if (!bytes?.length) throw badRequest("that image file could not be read");
  if (bytes.length > MAX_BYTES) throw badRequest("that image is too large to embed");
  const mimeType = sniffImageType(bytes);
  if (!mimeType) throw badRequest("that file is not a png, jpeg, gif or webp image");
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

function parseWebUrl(url: string, base?: URL): URL {
  let parsed: URL;
  try {
    parsed = new URL(url, base);
  } catch {
    throw badRequest("that is not an image address");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw badRequest("only http and https images can be fetched");
  }
  return parsed;
}

/**
 * Fetch, following redirects by hand so the guard runs on every hop: a public
 * URL that redirects to a private address would otherwise walk straight past a
 * check done only on the first one.
 */
async function fetchFollowingRedirects(first: URL): Promise<Response> {
  let target = first;
  for (let hop = 0; ; hop++) {
    await assertPublicHost(target.hostname);
    let res: Response;
    try {
      res = await fetch(target, {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (error) {
      log.debug({ err: error, host: target.hostname }, "signature image fetch failed");
      throw upstreamError("that image could not be downloaded");
    }
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return res;
    if (hop >= MAX_REDIRECTS) throw badRequest("that image address redirects too many times");
    target = parseWebUrl(location, target);
  }
}

/**
 * One image a pasted signature references as a data URI, or an AppError
 * explaining why it can't be inlined. The caller pastes on regardless and only
 * reports how many images could not come along.
 */
export async function fetchInlineImage(url: string): Promise<string> {
  if (url.toLowerCase().startsWith("file:")) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw badRequest("that is not an image address");
    }
    return readClipboardImage(parsed);
  }
  const res = await fetchFollowingRedirects(parseWebUrl(url));
  if (!res.ok) throw upstreamError(`that image answered ${res.status}`);

  const mimeType = (res.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  if (!mimeType || !ALLOWED_TYPES.has(mimeType)) {
    throw badRequest("that address is not a png, jpeg, gif or webp image");
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0) throw upstreamError("that image came back empty");
  if (bytes.length > MAX_BYTES) throw badRequest("that image is too large to embed");

  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}
