import { cp, readdir, readFile, rename, rm, rmdir, stat, utimes } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { WikiPage } from "@marlen/shared";
import { env } from "../../core/env.js";
import { moduleLogger } from "../../core/logger.js";
import { writeFileAtomic } from "../../core/utils/atomicFile.js";
import { slugify } from "../../core/utils/util.js";
import { sqlite } from "../../db/index.js";
import {
  deleteSetting,
  getAccountVoices,
  getSetting,
  patchAccountVoice,
  repointVoiceStyleMemory,
} from "../../db/settings.js";
import { allocatePageId, wikiPageRevision, writeWikiPageFile } from "../wiki/store.js";
import { getAgentHomeDir, knowledgeDir, resolveFolder, wikiDir } from "./agentHome.js";
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter.js";

/** Idempotent migrations whose destination is the filesystem. */

const log = moduleLogger("home");

function legacyMemoryDir(): string {
  return join(getAgentHomeDir(), "memory");
}

function legacySkillsDir(): string {
  return join(getAgentHomeDir(), "skills");
}

/** Move skill files after converting line-one descriptions to frontmatter. */
export async function migrateSkillsFolder(): Promise<void> {
  const source = resolve(env.skillsPath);
  const target = legacySkillsDir();
  if (source === target) return;
  let entries: string[];
  try {
    entries = await readdir(source);
  } catch {
    return;
  }
  let moved = 0;
  for (const file of entries) {
    if (!file.endsWith(".md")) continue;
    const text = await readFile(join(source, file), "utf8");
    await writeFileAtomic(join(target, file), convertSkillFile(text), 0o644);
    await rm(join(source, file));
    moved += 1;
  }
  await rmdir(source).catch(() => {});
  if (moved > 0) log.info({ moved, target }, "migrated skills into the agent home");
}

/** Export memory rows deterministically, remap voice references, then drop the table. */
export async function migrateMemoriesTable(): Promise<void> {
  const table = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memories'")
    .get();
  if (!table) return;

  interface Row {
    id: string;
    content: string;
    source: string;
    account_id: string | null;
    contact_id: string | null;
    used_count: number;
    last_used_at: string | null;
    created_at: string;
    updated_at: string;
  }
  const rows = sqlite.prepare("SELECT * FROM memories ORDER BY created_at, id").all() as Row[];

  const idMap = new Map<string, string>();
  const taken = new Set<string>();
  try {
    for (const file of await readdir(wikiDir())) {
      if (file.endsWith(".md")) taken.add(file.slice(0, -".md".length).normalize("NFC"));
    }
  } catch {
    // No wiki folder yet; nothing to collide with.
  }
  for (const row of rows) {
    const content = row.content.trim();
    if (!content) continue;
    const pageWithoutRevision: Omit<WikiPage, "revision"> = {
      id: allocatePageId(content, taken),
      type: null,
      content,
      source: row.source === "agent" ? "agent" : "user",
      accountId: row.account_id,
      contactId: row.contact_id,
      pinned: false,
      usedCount: row.used_count,
      lastUsedAt: row.last_used_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    const page: WikiPage = {
      ...pageWithoutRevision,
      revision: wikiPageRevision(pageWithoutRevision),
    };
    taken.add(page.id);
    idMap.set(row.id, page.id);
    await writeWikiPageFile(page);
  }

  for (const voice of await getAccountVoices()) {
    const ids = voice.styleMemoryIds ?? [];
    const mapped = ids.map((id) => idMap.get(id) ?? id);
    if (mapped.every((id, i) => id === ids[i])) continue;
    await patchAccountVoice(voice.accountId, (existing) => ({
      ...(existing ?? voice),
      styleMemoryIds: mapped,
    }));
  }

  sqlite.exec("DROP TABLE memories");
  if (rows.length > 0) log.info({ exported: idMap.size }, "migrated memories into the wiki");
}

const LEGACY_LIBRARY_FOLDER_KEY = "library.folder";

/** Move the managed library, but copy any user-chosen external folder. */
export async function migrateLibraryFolder(): Promise<void> {
  const target = knowledgeDir();
  const defaultSource = resolveFolder(env.libraryPath);
  await moveContentsInto(defaultSource, target);

  const saved = await getSetting(LEGACY_LIBRARY_FOLDER_KEY);
  if (saved === undefined) return;
  const chosen = resolveFolder(saved);
  if (chosen !== target && chosen !== defaultSource) {
    const copied = await copyContentsInto(chosen, target);
    if (copied > 0) {
      log.info(
        { from: chosen, copied, target },
        "copied the chosen library folder into the agent home (originals left in place)",
      );
    }
  }
  await deleteSetting(LEGACY_LIBRARY_FOLDER_KEY);
}

/** Move each managed folder into the current agent home. */
export async function migrateLegacyHome(): Promise<void> {
  const legacy = resolveFolder(env.legacyAgentHomePath);
  if (legacy === getAgentHomeDir()) return;
  await moveContentsInto(join(legacy, "memory"), legacyMemoryDir());
  await moveContentsInto(join(legacy, "skills"), legacySkillsDir());
  await moveContentsInto(join(legacy, "wiki"), wikiDir());
  await moveContentsInto(join(legacy, "knowledge"), knowledgeDir());
  await rmdir(legacy).catch(() => {});
}

/** Move every visible entry of `source` into `target` (skip name collisions), then drop `source` if emptied. */
async function moveContentsInto(source: string, target: string): Promise<void> {
  if (source === target) return;
  let entries: string[];
  try {
    entries = await readdir(source);
  } catch {
    return;
  }
  let moved = 0;
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const from = join(source, name);
    const to = join(target, name);
    if (await exists(to)) {
      log.warn({ name }, "not migrating library entry: the knowledge folder already has one");
      continue;
    }
    try {
      await rename(from, to);
    } catch {
      // Another filesystem (EXDEV), copy with timestamps, then remove.
      await cp(from, to, { recursive: true, preserveTimestamps: true });
      await rm(from, { recursive: true, force: true });
    }
    moved += 1;
  }
  await rmdir(source).catch(() => {});
  if (moved > 0) log.info({ moved, target }, "migrated files into the agent home");
}

/** Copy every visible entry of `source` into `target`, skipping collisions; returns the copy count. */
async function copyContentsInto(source: string, target: string): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(source);
  } catch {
    return 0;
  }
  let copied = 0;
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const to = join(target, name);
    if (await exists(to)) continue;
    await cp(join(source, name), to, { recursive: true, preserveTimestamps: true });
    copied += 1;
  }
  return copied;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Fold memory, skills, and notes into wiki pages without changing source mtimes. */
export async function migrateToWiki(): Promise<void> {
  const taken = new Set<string>();
  try {
    for (const file of await readdir(wikiDir())) {
      if (file.endsWith(".md")) taken.add(file.slice(0, -".md".length).normalize("NFC"));
    }
  } catch {
    // No wiki folder yet; nothing to collide with.
  }
  const renamed = new Map<string, string>();

  await foldFolder(legacyMemoryDir(), taken, renamed, (text, mtime) => {
    const { fields, body } = parseFrontmatter(text);
    if (!body) return null;
    return {
      fields: {
        source: fields.source === "agent" ? "agent" : "user",
        account: fields.account ?? "",
        contact: fields.contact ?? "",
        createdAt: fields.createdAt || mtime.toISOString(),
        usedCount: fields.usedCount ?? "",
        lastUsedAt: fields.lastUsedAt ?? "",
      },
      body,
    };
  });

  await foldFolder(legacySkillsDir(), taken, renamed, (text, mtime) => {
    const { fields, body } = parseFrontmatter(text);
    const description = fields.description ?? "";
    const content = description && body ? `${description}\n\n${body}` : description || body;
    if (!content) return null;
    return {
      fields: { type: "skill", source: "user", createdAt: mtime.toISOString() },
      body: content,
    };
  });

  await foldNotes(join(knowledgeDir(), "notes"), taken);

  // Voice pointers name style files by id; follow any collision renames.
  for (const [oldId, newId] of renamed) {
    if (oldId !== newId) await repointVoiceStyleMemory(oldId, newId);
  }
}

interface ConvertedPage {
  fields: Record<string, string>;
  body: string;
}

async function foldFolder(
  source: string,
  taken: Set<string>,
  renamed: Map<string, string>,
  convert: (text: string, mtime: Date) => ConvertedPage | null,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(source);
  } catch {
    return;
  }
  let moved = 0;
  for (const file of entries) {
    if (!file.endsWith(".md")) continue;
    const from = join(source, file);
    const [text, info] = [await readFile(from, "utf8"), await stat(from)];
    const page = convert(text, info.mtime);
    if (page) {
      const id = file.slice(0, -".md".length).normalize("NFC");
      renamed.set(id, await placePage(id, page, info.mtime, taken));
    }
    await rm(from);
    moved += 1;
  }
  await rmdir(source).catch(() => {});
  if (moved > 0) log.info({ moved, source }, "folded into the wiki");
}

/** Move markdown notes to the wiki and leave other library files in place. */
async function foldNotes(source: string, taken: Set<string>): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(source, { recursive: true });
  } catch {
    return;
  }
  let moved = 0;
  for (const rel of entries) {
    if (!rel.endsWith(".md")) continue;
    const from = join(source, rel);
    const info = await stat(from).catch(() => null);
    if (!info?.isFile()) continue;
    const body = (await readFile(from, "utf8")).trim();
    if (body) {
      const preferred = slugify(rel.slice(0, -".md".length)) || allocatePageId(body, taken);
      await placePage(
        preferred,
        { fields: { source: "user", createdAt: info.mtime.toISOString() }, body },
        info.mtime,
        taken,
      );
    }
    await rm(from);
    moved += 1;
  }
  // Remove only directories emptied by the move.
  const dirs: string[] = [];
  for (const rel of entries) {
    const path = join(source, rel);
    const info = await stat(path).catch(() => null);
    if (info?.isDirectory()) dirs.push(path);
  }
  for (const dir of dirs.sort((a, b) => b.length - a.length)) await rmdir(dir).catch(() => {});
  await rmdir(source).catch(() => {});
  if (moved > 0) log.info({ moved, source }, "folded notes into the wiki");
}

async function placePage(
  preferredId: string,
  page: ConvertedPage,
  mtime: Date,
  taken: Set<string>,
): Promise<string> {
  const serialized = serializeFrontmatter(page.fields, page.body);
  let id = preferredId;
  if (taken.has(id)) {
    const existing = await readFile(join(wikiDir(), `${id}.md`), "utf8").catch(() => null);
    // Reuse an identical file from an interrupted run.
    if (existing === serialized) return id;
    for (let n = 2; taken.has(id); n += 1) id = `${preferredId}-${n}`;
  }
  const path = join(wikiDir(), `${id}.md`);
  await writeFileAtomic(path, serialized, 0o644);
  await utimes(path, mtime, mtime);
  taken.add(id);
  return id;
}

function convertSkillFile(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (normalized.startsWith("---\n")) return `${normalized}\n`;
  const firstBreak = normalized.indexOf("\n");
  const description = firstBreak === -1 ? normalized : normalized.slice(0, firstBreak).trim();
  const instructions = firstBreak === -1 ? "" : normalized.slice(firstBreak).trim();
  return serializeFrontmatter({ description }, instructions);
}
