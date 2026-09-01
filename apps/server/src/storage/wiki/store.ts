import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  splitPage,
  WIKI_PAGE_MAX_COUNT,
  WIKI_PAGE_MAX_LENGTH,
  type WikiPage,
} from "@marlen/shared";
import { emitServerEvent } from "../../core/events.js";
import { moduleLogger } from "../../core/logger.js";
import { writeFileAtomic } from "../../core/utils/atomicFile.js";
import { slugify } from "../../core/utils/util.js";
import { wikiDir } from "../home/agentHome.js";
import { parseFrontmatter, serializeFrontmatter } from "../home/frontmatter.js";

/**
 * The wiki: the agent's long-term memory as one markdown page per entity or
 * topic (a person, a company, a deal, a recipe, a skill) in the agent home's
 * wiki/ folder. The filename (minus .md) is the page id. A page is summary +
 * body (split at the first blank line): the summary rides the system prompt,
 * the body stays on disk behind page_read. Type, scope, source and usage
 * counters live in flat frontmatter; the page text is the file body. The
 * folder is the source of truth: a bare sentence dropped in by hand is a
 * valid global page. A page's id never changes once written: the prompt,
 * chat cards, voice-style pointers and the agent's own notes all refer to
 * pages by id, so an edit rewrites the file in place. Pages of type "skill"
 * are the one behavioral type; their id is their invocation name.
 * Replacements carry an opaque base revision so a stale editor cannot erase a
 * newer write. Usage counters are outside that revision and never conflict
 * with a content edit.
 */

const log = moduleLogger("wiki");

type EditablePageFields = Pick<WikiPage, "content" | "type" | "accountId" | "contactId" | "pinned">;

export function wikiPageRevision(page: EditablePageFields): string {
  return createHash("sha256")
    .update(JSON.stringify([page.content, page.type, page.accountId, page.contactId, page.pinned]))
    .digest("base64url")
    .slice(0, 16);
}

function withRevision(page: Omit<WikiPage, "revision">): WikiPage {
  return { ...page, revision: wikiPageRevision(page) };
}

/** Lowercase, whitespace-collapsed, no trailing period; for duplicate detection only. */
function normalizeForDedup(content: string): string {
  const collapsed = content.toLowerCase().replace(/\s+/g, " ").trim();
  return collapsed.replace(/\.$/, "");
}

/** Lowercased, trimmed; matches how contact addresses are normalized everywhere. */
function normalizeContactId(contactId: string): string {
  return contactId.trim().toLowerCase();
}

/** A page is global (both null), account-scoped, OR contact-scoped; never both. */
function assertSingleScope(accountId: string | null, contactId: string | null): void {
  if (accountId !== null && contactId !== null) {
    throw new Error("a wiki page cannot be scoped to both an account and a contact");
  }
}

function pagePath(id: string): string {
  return join(wikiDir(), `${id}.md`);
}

/** Parse one page file; null when it has no content or an impossible scope. */
function parsePage(id: string, text: string, mtime: Date): WikiPage | null {
  const { fields, body } = parseFrontmatter(text);
  if (!body) return null;
  const accountId = fields.account || null;
  const contactId = fields.contact ? normalizeContactId(fields.contact) : null;
  if (accountId !== null && contactId !== null) {
    log.warn({ id }, "wiki page scoped to both an account and a contact; skipped");
    return null;
  }
  const usedCount = Number.parseInt(fields.usedCount ?? "", 10);
  return withRevision({
    id,
    type: fields.type || null,
    content: body,
    source: fields.source === "agent" ? "agent" : "user",
    accountId,
    contactId,
    pinned: fields.pinned === "true",
    usedCount: Number.isNaN(usedCount) ? 0 : usedCount,
    lastUsedAt: fields.lastUsedAt || null,
    createdAt: fields.createdAt || mtime.toISOString(),
    updatedAt: mtime.toISOString(),
  });
}

/** The frontmatter a page writes back; type, counters and scope omitted when empty. */
function pageFields(page: WikiPage): Record<string, string> {
  return {
    type: page.type ?? "",
    source: page.source,
    account: page.accountId ?? "",
    contact: page.contactId ?? "",
    pinned: page.pinned ? "true" : "",
    createdAt: page.createdAt,
    usedCount: page.usedCount > 0 ? String(page.usedCount) : "",
    lastUsedAt: page.lastUsedAt ?? "",
  };
}

/** Also the boot migration's writer, so exported: files it creates are exactly the store's shape. */
export async function writeWikiPageFile(page: WikiPage): Promise<void> {
  await writeFileAtomic(
    pagePath(page.id),
    serializeFrontmatter(pageFields(page), page.content),
    0o644,
  );
  cache.delete(`${page.id}.md`);
}

interface CachedFile {
  mtimeMs: number;
  size: number;
  page: WikiPage | null;
}

/**
 * Parsed pages by filename, keyed on the file's mtime and size. Every
 * listing still reads the folder and stats each file, so a page dropped in
 * or edited by hand shows up on the next call; only unchanged files skip
 * the read and parse. The store's own writes evict their entry outright, so
 * a rewrite within one mtime tick is never served stale. The cache follows
 * the home folder: a different wikiDir() starts it over.
 */
const cache = new Map<string, CachedFile>();
let cacheDir = "";

/** All whole-file wiki rewrites share one lane so counters cannot erase edits. */
let pageMutationChain: Promise<void> = Promise.resolve();

function serializePageMutation<T>(operation: () => Promise<T>): Promise<T> {
  const run = pageMutationChain.then(operation);
  pageMutationChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function listPages(): Promise<WikiPage[]> {
  const dir = wikiDir();
  if (dir !== cacheDir) {
    cache.clear();
    cacheDir = dir;
  }
  let files: string[];
  try {
    files = (await readdir(dir)).filter((file) => file.endsWith(".md"));
  } catch {
    cache.clear();
    return [];
  }
  const present = new Set(files);
  for (const file of cache.keys()) if (!present.has(file)) cache.delete(file);
  await Promise.all(
    files.map(async (file) => {
      const path = join(dir, file);
      try {
        const info = await stat(path);
        const hit = cache.get(file);
        if (hit && hit.mtimeMs === info.mtimeMs && hit.size === info.size) return;
        const text = await readFile(path, "utf8");
        // macOS readdir can return NFD names; NFC normalization round-trips ids as typed.
        const id = file.slice(0, -".md".length).normalize("NFC");
        cache.set(file, {
          mtimeMs: info.mtimeMs,
          size: info.size,
          page: parsePage(id, text, info.mtime),
        });
      } catch {
        cache.delete(file);
      }
    }),
  );
  return [...cache.values()]
    .map((entry) => entry.page)
    .filter((p): p is WikiPage => p !== null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** A filename no existing page uses: summary slug, then -2/-3…; hex fallback for empty slugs. */
export function allocatePageId(content: string, taken: Set<string>): string {
  const base = slugify(splitPage(content).summary) || `page-${randomUUID().slice(0, 6)}`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Optional attributes on create/update. undefined = keep (or default); null/"" = clear. */
export interface PageAttrs {
  type?: string | null;
  accountId?: string | null;
  contactId?: string | null;
  pinned?: boolean;
}

/**
 * Resolve attrs against the page they apply to. Setting one scope axis moves
 * the page there: the other axis clears unless the caller sent it too — under
 * the one-scope rule, "set this axis and keep the other" could only ever be a
 * conflict.
 */
function resolveAttrs(
  current: WikiPage | undefined,
  attrs: PageAttrs,
): { type: string | null; accountId: string | null; contactId: string | null; pinned: boolean } {
  const type = attrs.type !== undefined ? attrs.type || null : (current?.type ?? null);
  let accountId =
    attrs.accountId !== undefined ? attrs.accountId || null : (current?.accountId ?? null);
  let contactId =
    attrs.contactId !== undefined
      ? attrs.contactId
        ? normalizeContactId(attrs.contactId)
        : null
      : (current?.contactId ?? null);
  if (attrs.accountId != null && attrs.contactId === undefined) contactId = null;
  if (attrs.contactId != null && attrs.accountId === undefined) accountId = null;
  assertSingleScope(accountId, contactId);
  return { type, accountId, contactId, pinned: attrs.pinned ?? current?.pinned ?? false };
}

function validateContent(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("page content must not be empty");
  if (trimmed.length > WIKI_PAGE_MAX_LENGTH) {
    throw new Error(`page content must be at most ${WIKI_PAGE_MAX_LENGTH} characters`);
  }
  return trimmed;
}

function assertRoom(count: number): void {
  if (count >= WIKI_PAGE_MAX_COUNT) {
    throw new Error(
      `the wiki is full (${WIKI_PAGE_MAX_COUNT} pages), delete some on the Knowledge page`,
    );
  }
}

export interface CreatePageResult {
  page: WikiPage;
  /** False when an existing page already matched and was returned instead. */
  created: boolean;
}

/** Create a page named after its content, deduplicating within the same scope. */
export async function createPage(
  content: string,
  source: WikiPage["source"],
  attrs: PageAttrs = {},
): Promise<CreatePageResult> {
  return serializePageMutation(async () => {
    const trimmed = validateContent(content);
    const { type, accountId, contactId, pinned } = resolveAttrs(undefined, attrs);

    // Dedup within the same (accountId, contactId) scope only: the same fact may
    // legitimately exist for two accounts, two contacts, or globally and scoped.
    const existing = await listPages();
    const target = normalizeForDedup(trimmed);
    for (const page of existing) {
      if (
        page.accountId === accountId &&
        page.contactId === contactId &&
        normalizeForDedup(page.content) === target
      ) {
        return { page, created: false };
      }
    }

    assertRoom(existing.length);
    const now = new Date().toISOString();
    const page = withRevision({
      id: allocatePageId(trimmed, new Set(existing.map((p) => p.id))),
      type,
      content: trimmed,
      source,
      accountId,
      contactId,
      pinned,
      usedCount: 0,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    await writeWikiPageFile(page);
    emitServerEvent("wiki");
    return { page, created: true };
  });
}

/**
 * Create the page at slugify(name), for pages whose id is chosen rather than
 * derived (skills, canonical entity pages). Existing named pages must go
 * through updatePage's revision guard; a create never overwrites one.
 */
export async function writeNamedPage(
  name: string,
  content: string,
  source: WikiPage["source"],
  attrs: PageAttrs = {},
): Promise<WikiPage> {
  return serializePageMutation(async () => {
    const id = slugify(name);
    if (!id) throw new Error("page name must contain letters or digits");
    const trimmed = validateContent(content);
    const existing = await listPages();
    const current = existing.find((p) => p.id === id);
    if (current) throw new Error(`wiki page ${id} already exists; update it instead`);
    const { type, accountId, contactId, pinned } = resolveAttrs(undefined, attrs);
    assertRoom(existing.length);
    const now = new Date().toISOString();
    const page = withRevision({
      id,
      type,
      content: trimmed,
      source,
      accountId,
      contactId,
      pinned,
      usedCount: 0,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    await writeWikiPageFile(page);
    emitServerEvent("wiki");
    return page;
  });
}

/**
 * Resolve a full page id or an unambiguous id prefix (≥6 chars, as shown
 * bracketed in the system prompt) to its page. Null when not found or when
 * a short prefix matches more than one page.
 */
function resolvePage(idOrPrefix: string, pages: WikiPage[]): WikiPage | null {
  const trimmed = idOrPrefix.trim();
  if (!trimmed) return null;
  const exact = pages.find((page) => page.id === trimmed);
  if (exact) return exact;
  if (trimmed.length < 6) return null;
  const matches = pages.filter((page) => page.id.startsWith(trimmed));
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

export interface PageUpdateGuard {
  baseRevision: string;
}

export class WikiPageConflictError extends Error {
  constructor(readonly current: WikiPage) {
    super(`wiki page ${current.id} changed after it was read`);
    this.name = "WikiPageConflictError";
  }
}

/** Rewrite a page in place; the id stays whatever it was written as. */
export async function updatePage(
  idOrPrefix: string,
  content: string,
  attrs: PageAttrs = {},
  guard?: PageUpdateGuard,
): Promise<WikiPage | null> {
  return serializePageMutation(async () => {
    const current = resolvePage(idOrPrefix, await listPages());
    if (!current) return null;
    if (guard && current.revision !== guard.baseRevision) {
      throw new WikiPageConflictError(current);
    }
    const trimmed = validateContent(content);
    const { type, accountId, contactId, pinned } = resolveAttrs(current, attrs);
    const next = withRevision({
      ...current,
      type,
      content: trimmed,
      accountId,
      contactId,
      pinned,
      updatedAt: new Date().toISOString(),
    });
    await writeWikiPageFile(next);
    emitServerEvent("wiki");
    return next;
  });
}

export async function deletePage(idOrPrefix: string, guard?: PageUpdateGuard): Promise<boolean> {
  return serializePageMutation(async () => {
    const page = resolvePage(idOrPrefix, await listPages());
    if (!page) return false;
    if (guard && page.revision !== guard.baseRevision) {
      throw new WikiPageConflictError(page);
    }
    try {
      await rm(pagePath(page.id));
    } catch {
      return false;
    }
    cache.delete(`${page.id}.md`);
    emitServerEvent("wiki");
    return true;
  });
}

/**
 * Bump the usage counter (and stamp lastUsedAt) for each page the agent relied
 * on this turn. Accepts full ids or the ≥6-char prefixes shown bracketed in the
 * prompt; unresolved or duplicate ids are skipped silently, so a miscited id
 * never fails the turn. Returns the pages actually recorded.
 */
export async function recordPageUse(idsOrPrefixes: string[]): Promise<WikiPage[]> {
  return serializePageMutation(async () => {
    const pages = await listPages();
    const now = new Date().toISOString();
    const seen = new Set<string>();
    const recorded: WikiPage[] = [];
    for (const raw of idsOrPrefixes) {
      const page = resolvePage(raw, pages);
      if (!page || seen.has(page.id)) continue;
      seen.add(page.id);
      const next = { ...page, usedCount: page.usedCount + 1, lastUsedAt: now };
      await writeWikiPageFile(next);
      recorded.push(next);
    }
    if (recorded.length > 0) emitServerEvent("wiki");
    return recorded;
  });
}

/** Read one page by id or unambiguous ≥6-char prefix; null when not found. */
export async function readPage(idOrPrefix: string): Promise<WikiPage | null> {
  return resolvePage(idOrPrefix, await listPages());
}
