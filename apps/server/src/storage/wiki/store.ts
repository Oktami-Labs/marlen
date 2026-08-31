import { randomUUID } from "node:crypto";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  splitPage,
  WIKI_PAGE_MAX_COUNT,
  WIKI_PAGE_MAX_LENGTH,
  WIKI_TYPE_SKILL,
  type WikiPage,
} from "@marlen/shared";
import { emitServerEvent } from "../../core/events.js";
import { moduleLogger } from "../../core/logger.js";
import { writeFileAtomic } from "../../core/utils/atomicFile.js";
import { slugify } from "../../core/utils/util.js";
import { repointVoiceStyleMemory } from "../../db/settings.js";
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
 * valid global page. Pages of type "skill" are the one behavioral type —
 * their id is their invocation name and never changes on edit.
 * Single-process, last-writer-wins: interleaved rewrites of one file
 * (use-counter vs edit) are acceptable for a single user.
 */

const log = moduleLogger("wiki");

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
  return {
    id,
    type: fields.type || null,
    content: body,
    source: fields.source === "agent" ? "agent" : "user",
    accountId,
    contactId,
    usedCount: Number.isNaN(usedCount) ? 0 : usedCount,
    lastUsedAt: fields.lastUsedAt || null,
    createdAt: fields.createdAt || mtime.toISOString(),
    updatedAt: mtime.toISOString(),
  };
}

/** The frontmatter a page writes back; type, counters and scope omitted when empty. */
function pageFields(page: WikiPage): Record<string, string> {
  return {
    type: page.type ?? "",
    source: page.source,
    account: page.accountId ?? "",
    contact: page.contactId ?? "",
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
}

export async function listPages(): Promise<WikiPage[]> {
  let files: string[];
  try {
    files = await readdir(wikiDir());
  } catch {
    return [];
  }
  const pages = await Promise.all(
    files
      .filter((file) => file.endsWith(".md"))
      .map(async (file): Promise<WikiPage | null> => {
        const path = join(wikiDir(), file);
        try {
          const [text, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
          // macOS readdir can return NFD names; NFC normalization round-trips ids as typed.
          return parsePage(file.slice(0, -".md".length).normalize("NFC"), text, info.mtime);
        } catch {
          return null;
        }
      }),
  );
  return pages
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
): { type: string | null; accountId: string | null; contactId: string | null } {
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
  return { type, accountId, contactId };
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
  const trimmed = validateContent(content);
  const { type, accountId, contactId } = resolveAttrs(undefined, attrs);

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
  const page: WikiPage = {
    id: allocatePageId(trimmed, new Set(existing.map((p) => p.id))),
    type,
    content: trimmed,
    source,
    accountId,
    contactId,
    usedCount: 0,
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await writeWikiPageFile(page);
  emitServerEvent("wiki");
  return { page, created: true };
}

/**
 * Create or replace the page at slugify(name): the named write for pages whose
 * id is chosen rather than derived (skills, canonical entity pages). Replacing
 * keeps the original createdAt and usage counters; omitted attrs keep the
 * existing page's values.
 */
export async function writeNamedPage(
  name: string,
  content: string,
  source: WikiPage["source"],
  attrs: PageAttrs = {},
): Promise<WikiPage> {
  const id = slugify(name);
  if (!id) throw new Error("page name must contain letters or digits");
  const trimmed = validateContent(content);
  const existing = await listPages();
  const current = existing.find((p) => p.id === id);
  const { type, accountId, contactId } = resolveAttrs(current, attrs);
  if (!current) assertRoom(existing.length);
  const now = new Date().toISOString();
  const page: WikiPage = {
    id,
    type,
    content: trimmed,
    source,
    accountId,
    contactId,
    usedCount: current?.usedCount ?? 0,
    lastUsedAt: current?.lastUsedAt ?? null,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };
  await writeWikiPageFile(page);
  emitServerEvent("wiki");
  return page;
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

/**
 * True when the page's id was derived from its content: only then does an
 * edit rename the file to follow the new content. A chosen name (a skill, a
 * writeNamedPage id, a hex fallback) stays put so references to it hold.
 */
function contentNamed(page: WikiPage): boolean {
  const slug = slugify(splitPage(page.content).summary);
  return slug !== "" && (page.id === slug || page.id.startsWith(`${slug}-`));
}

export async function updatePage(
  idOrPrefix: string,
  content: string,
  attrs: PageAttrs = {},
): Promise<WikiPage | null> {
  const pages = await listPages();
  const current = resolvePage(idOrPrefix, pages);
  if (!current) return null;
  const trimmed = validateContent(content);
  const { type, accountId, contactId } = resolveAttrs(current, attrs);

  // A content-named page follows its content: the browsable folder never lies
  // about what a file holds. Named pages (skills above all) keep their id.
  const contentChanged = trimmed !== current.content;
  const renames = contentChanged && type !== WIKI_TYPE_SKILL && contentNamed(current);
  const taken = new Set(pages.filter((p) => p.id !== current.id).map((p) => p.id));
  const next: WikiPage = {
    ...current,
    id: renames ? allocatePageId(trimmed, taken) : current.id,
    type,
    content: trimmed,
    accountId,
    contactId,
    updatedAt: new Date().toISOString(),
  };
  await writeWikiPageFile(next);
  if (next.id !== current.id) {
    await rm(pagePath(current.id)).catch(() => {});
    await repointVoiceStyleMemory(current.id, next.id);
  }
  emitServerEvent("wiki");
  return next;
}

export async function deletePage(idOrPrefix: string): Promise<boolean> {
  const page = resolvePage(idOrPrefix, await listPages());
  if (!page) return false;
  try {
    await rm(pagePath(page.id));
  } catch {
    return false;
  }
  emitServerEvent("wiki");
  return true;
}

/**
 * Bump the usage counter (and stamp lastUsedAt) for each page the agent
 * reported relying on this turn via the page_used tool. Accepts full ids or
 * the ≥6-char prefixes shown bracketed in the prompt; unresolved or duplicate
 * ids are skipped silently, so a miscited id never fails the turn. The write
 * also bumps the file's mtime, which is what promotes a decayed page back
 * into the prompt's full tier. Returns the pages actually recorded.
 */
export async function recordPageUse(idsOrPrefixes: string[]): Promise<WikiPage[]> {
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
}

/** Read one page by id or unambiguous ≥6-char prefix; null when not found. */
export async function readPage(idOrPrefix: string): Promise<WikiPage | null> {
  return resolvePage(idOrPrefix, await listPages());
}
