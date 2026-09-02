import { randomUUID } from "node:crypto";
import { type Dirent, type FSWatcher, watch } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { type HtmlToTextOptions, htmlToText } from "html-to-text";
import { emitServerEvent } from "../../core/events.js";
import { moduleLogger } from "../../core/logger.js";
import { errorMessage } from "../../core/utils/util.js";
import { knowledgeDir, resolveWithin } from "../home/agentHome.js";
import * as store from "./store.js";

const ingestLog = moduleLogger("library");

export const LIBRARY_EXTENSIONS = new Set([
  ".pdf",
  ".md",
  ".markdown",
  ".txt",
  ".docx",
  ".csv",
  ".html",
  ".htm",
]);
export const SUPPORTED_FORMATS = "PDF, Word (.docx), Markdown, text, CSV, HTML";

const libraryDir = knowledgeDir();

export function getLibraryDir(): string {
  return libraryDir;
}

/** Reject paths outside the knowledge folder and the folder itself. */
export function documentPath(relPath: string): string | null {
  const absPath = resolveWithin(libraryDir, relPath);
  return absPath === libraryDir ? null : absPath;
}

const MAX_TEXT_LENGTH = 2_000_000;
const CHUNK_TARGET = 1800;
const MAX_FILE_SIZE = 100 * 1024 * 1024;

const QUIESCENCE_RECENT_MS = 5000;
const QUIESCENCE_WAIT_MS = 500;
const QUIESCENCE_RESCAN_MS = 2000;

const HTML_EXTRACT_OPTIONS: HtmlToTextOptions = {
  wordwrap: false,
  selectors: ["h1", "h2", "h3", "h4", "h5", "h6"].map((selector) => ({
    selector,
    options: { uppercase: false },
  })),
};

// Load large format parsers only when needed.
async function extractText(data: Buffer, ext: string): Promise<string> {
  if (ext === ".pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(data) });
    try {
      return (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  }
  if (ext === ".docx") {
    const { default: mammoth } = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: data });
    return value;
  }
  if (ext === ".html" || ext === ".htm") {
    return htmlToText(data.toString("utf8"), HTML_EXTRACT_OPTIONS).trim();
  }
  return data.toString("utf8");
}

function normalize(text: string): string {
  return (
    text
      .replace(/\r\n/g, "\n")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: strips NUL bytes from extracted document text before storage/indexing
      .replace(/\u0000/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, MAX_TEXT_LENGTH)
  );
}

export async function extractDocumentText(data: Buffer, ext: string): Promise<string> {
  return normalize(await extractText(data, ext));
}

/** Split on nearby text boundaries without dropping characters. */
function chunkText(text: string, target = CHUNK_TARGET): string[] {
  const chunks: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    let end = Math.min(pos + target, text.length);
    if (end < text.length) {
      const windowStart = pos + Math.floor(target / 2);
      const window = text.slice(windowStart, end);
      for (const boundary of ["\n\n", "\n", ". "]) {
        const at = window.lastIndexOf(boundary);
        if (at !== -1) {
          end = windowStart + at + boundary.length;
          break;
        }
      }
    }
    chunks.push(text.slice(pos, end));
    pos = end;
  }
  return chunks;
}

async function listFiles(): Promise<Map<string, { size: number; mtimeMs: number }>> {
  const found = new Map<string, { size: number; mtimeMs: number }>();
  const visit = async (rel: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(join(libraryDir, rel), { withFileTypes: true });
    } catch (error) {
      ingestLog.warn({ err: error, rel }, "skipping unreadable library directory");
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await visit(relPath);
      } else if (entry.isFile()) {
        try {
          const info = await stat(join(libraryDir, relPath));
          found.set(relPath, { size: info.size, mtimeMs: Math.round(info.mtimeMs) });
        } catch {}
      }
    }
  };
  await visit("");
  return found;
}

async function indexFile(relPath: string, size: number, mtimeMs: number): Promise<boolean> {
  const ext = extname(relPath).toLowerCase();
  const base = {
    path: relPath,
    title: basename(relPath, extname(relPath)),
    ext: ext.slice(1),
    size,
    mtimeMs,
  };
  // Record unsupported files without reading them.
  if (size > MAX_FILE_SIZE) {
    store.replaceDocument(
      { ...base, status: "error", error: "file too large to index", textLength: 0 },
      [],
    );
    return false;
  }
  if (!LIBRARY_EXTENSIONS.has(ext)) {
    store.replaceDocument(
      {
        ...base,
        status: "error",
        error: `unsupported file format — supported: ${SUPPORTED_FORMATS}`,
        textLength: 0,
      },
      [],
    );
    return false;
  }
  try {
    const text = await extractDocumentText(await readFile(join(libraryDir, relPath)), ext);
    if (!text) {
      store.replaceDocument(
        {
          ...base,
          status: "error",
          error: "no readable text in this file — a scanned PDF has no text layer",
          textLength: 0,
        },
        [],
      );
      return false;
    }
    store.replaceDocument(
      { ...base, status: "indexed", error: null, textLength: text.length },
      chunkText(text),
    );
    return true;
  } catch (error) {
    store.replaceDocument(
      { ...base, status: "error", error: errorMessage(error), textLength: 0 },
      [],
    );
    return false;
  }
}

interface ScanSummary {
  indexed: number;
  failed: number;
  removed: number;
}

let scanning: Promise<ScanSummary> | null = null;
let rescanWanted = false;

export function scanLibrary(): Promise<ScanSummary> {
  if (scanning) {
    rescanWanted = true;
    return scanning;
  }
  scanning = doScan().finally(() => {
    scanning = null;
    if (rescanWanted) {
      rescanWanted = false;
      scanLibrary().catch((error: unknown) =>
        ingestLog.error({ err: error }, "chained library rescan failed"),
      );
    }
  });
  return scanning;
}

async function isStillChanging(relPath: string): Promise<boolean> {
  const absPath = join(libraryDir, relPath);
  try {
    const before = await stat(absPath);
    await sleep(QUIESCENCE_WAIT_MS);
    const after = await stat(absPath);
    return after.size !== before.size || after.mtimeMs !== before.mtimeMs;
  } catch {
    return true;
  }
}

async function doScan(): Promise<ScanSummary> {
  await mkdir(libraryDir, { recursive: true });
  const files = await listFiles();
  const documents = await store.listDocuments();
  const summary: ScanSummary = { indexed: 0, failed: 0, removed: 0 };

  for (const doc of documents) {
    if (!files.has(doc.path)) {
      store.removeDocument(doc.id);
      summary.removed += 1;
    }
  }

  const byPath = new Map(documents.map((d) => [d.path, d]));
  let settling = false;
  for (const [relPath, info] of files) {
    const known = byPath.get(relPath);
    const unchanged =
      known &&
      known.size === info.size &&
      known.modifiedAt === new Date(info.mtimeMs).toISOString();
    if (unchanged) continue;
    // Delay indexing until an active copy settles.
    if (Date.now() - info.mtimeMs < QUIESCENCE_RECENT_MS && (await isStillChanging(relPath))) {
      settling = true;
      continue;
    }
    // Bound extraction load to one document at a time.
    if (await indexFile(relPath, info.size, info.mtimeMs)) summary.indexed += 1;
    else summary.failed += 1;
  }
  if (settling) scheduleScan(QUIESCENCE_RESCAN_MS);
  if (summary.indexed || summary.failed || summary.removed) emitServerEvent("library");
  return summary;
}

let watcher: FSWatcher | null = null;
let scanTimer: NodeJS.Timeout | null = null;
let watcherRetryTimer: NodeJS.Timeout | null = null;
/** Prevent delayed retries from reviving a superseded watcher. */
let watcherGeneration = 0;
const WATCHER_RETRY_MS = 30_000;

function scheduleScan(delayMs: number): void {
  if (scanTimer) clearTimeout(scanTimer);
  scanTimer = setTimeout(() => {
    scanLibrary().catch((error: unknown) =>
      ingestLog.error({ err: error }, "scheduled library scan failed"),
    );
  }, delayMs);
}

function stopWatcher(): void {
  watcher?.close();
  watcher = null;
  watcherGeneration += 1;
  if (scanTimer) {
    clearTimeout(scanTimer);
    scanTimer = null;
  }
  if (watcherRetryTimer) {
    clearTimeout(watcherRetryTimer);
    watcherRetryTimer = null;
  }
}

function startWatcher(): void {
  stopWatcher();
  const generation = watcherGeneration;
  try {
    const instance = watch(libraryDir, { recursive: true }, () => scheduleScan(1000));
    watcher = instance;
    instance.on("error", (error) => {
      if (watcherGeneration !== generation) return;
      ingestLog.warn(
        { err: error, folder: libraryDir },
        `library watcher failed — retrying in ${WATCHER_RETRY_MS / 1000}s`,
      );
      instance.close();
      watcher = null;
      watcherRetryTimer = setTimeout(() => {
        watcherRetryTimer = null;
        if (watcherGeneration !== generation) return;
        startWatcher();
      }, WATCHER_RETRY_MS);
    });
  } catch {}
}

export async function startLibrary(log: (message: string) => void): Promise<void> {
  await mkdir(libraryDir, { recursive: true });
  scanLibrary()
    .then((s) => {
      if (s.indexed || s.failed || s.removed) {
        log(`Library scan: ${s.indexed} indexed, ${s.removed} removed, ${s.failed} failed`);
      }
    })
    .catch((error: unknown) => ingestLog.error({ err: error }, "initial library scan failed"));
  startWatcher();
}

export function stopLibrary(): void {
  stopWatcher();
}

/** Write through a hidden temp file so the scanner never sees partial content. */
async function writeIntoLibrary(
  relDir: string,
  name: string,
  tempPrefix: string,
  data: string | Buffer,
): Promise<string> {
  const dir = relDir ? join(libraryDir, relDir) : libraryDir;
  await mkdir(dir, { recursive: true });
  const tempPath = join(dir, `.${tempPrefix}-${randomUUID()}`);
  try {
    await writeFile(tempPath, data);
    await rename(tempPath, join(dir, name));
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
  await scanLibrary();
  return relDir ? `${relDir}/${name}` : name;
}

export async function saveUpload(fileName: string, data: Buffer, relDir = ""): Promise<string> {
  const name = basename(fileName.trim());
  if (!name || name.startsWith(".")) throw new Error("invalid file name");
  if (!LIBRARY_EXTENSIONS.has(extname(name).toLowerCase())) {
    throw new Error(`unsupported file type — use ${[...LIBRARY_EXTENSIONS].join(", ")}`);
  }
  if (relDir && !resolveWithin(libraryDir, relDir)) throw new Error("invalid target folder");
  return writeIntoLibrary(relDir, name, "upload", data);
}

export async function listFolders(): Promise<string[]> {
  const found: string[] = [];
  const visit = async (rel: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(join(libraryDir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      found.push(relPath);
      await visit(relPath);
    }
  };
  await visit("");
  return found.sort();
}

export async function createFolder(relPath: string): Promise<boolean> {
  const absPath = documentPath(relPath);
  if (!absPath) return false;
  await mkdir(absPath, { recursive: true });
  emitServerEvent("library");
  return true;
}

/** Recursive deletion is allowed only for a verified directory inside knowledge. */
export async function deleteFolder(relPath: string): Promise<boolean> {
  const absPath = documentPath(relPath);
  if (!absPath) return false;
  const info = await stat(absPath).catch(() => null);
  if (!info?.isDirectory()) return false;
  await rm(absPath, { recursive: true, force: true });
  await scanLibrary();
  emitServerEvent("library");
  return true;
}

const EDITABLE_EXTENSIONS = new Set(["md", "markdown", "txt"]);
const MAX_EDITABLE_SIZE = 1024 * 1024;

export async function readDocumentText(id: string): Promise<string | null> {
  const doc = await store.getDocument(id);
  if (!doc || !EDITABLE_EXTENSIONS.has(doc.ext) || doc.size > MAX_EDITABLE_SIZE) return null;
  const absPath = documentPath(doc.path);
  if (!absPath) return null;
  try {
    return await readFile(absPath, "utf8");
  } catch {
    return null;
  }
}

export async function writeDocumentText(id: string, content: string): Promise<boolean> {
  const doc = await store.getDocument(id);
  if (!doc || !EDITABLE_EXTENSIONS.has(doc.ext)) return false;
  if (!documentPath(doc.path)) return false;
  const slash = doc.path.lastIndexOf("/");
  await writeIntoLibrary(
    slash === -1 ? "" : doc.path.slice(0, slash),
    slash === -1 ? doc.path : doc.path.slice(slash + 1),
    "edit",
    content,
  );
  return true;
}

/** A malformed stored path may remove its index row, never a file outside knowledge. */
export async function deleteDocument(id: string): Promise<boolean> {
  const doc = await store.getDocument(id);
  if (!doc) return false;
  const absPath = documentPath(doc.path);
  if (absPath) await rm(absPath, { force: true });
  store.removeDocument(id);
  emitServerEvent("library");
  return true;
}
