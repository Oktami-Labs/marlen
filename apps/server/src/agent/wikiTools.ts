import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  formatFileSize,
  splitPage,
  WIKI_PAGE_MAX_COUNT,
  WIKI_SUMMARY_MAX_LENGTH,
  WIKI_TYPE_SKILL,
  type WikiPage,
} from "@marlen/shared";
import { Type } from "@sinclair/typebox";
import { groupBy } from "../core/utils/util.js";
import { getLibraryDir, SUPPORTED_FORMATS } from "../storage/library/ingest.js";
import {
  getDocument,
  listDocuments,
  readDocumentChunks,
  searchChunks,
} from "../storage/library/store.js";
import {
  createPage,
  deletePage,
  listPages,
  readPage,
  recordPageUse,
  updatePage,
  writeNamedPage,
} from "../storage/wiki/store.js";
import { fetchAccountNameMap, resolveAccountParam } from "./accounts.js";
import { buildWikiNoteCard, cardNote } from "./cards.js";
import { clampLimit, textResult, tool } from "./toolkit.js";

/** Chunks per library_read part, ≈ 15k characters. */
const PART_CHUNKS = 8;

interface PageScope {
  accountId: string | null;
  contactId: string | null;
  label: string;
}

/** contact:<address> is lowercased to match how page contact scope is normalized. */
async function resolvePageScope(raw: string): Promise<PageScope | { error: string }> {
  const trimmed = raw.trim();
  if (trimmed.toLowerCase() === "general") {
    return { accountId: null, contactId: null, label: "general" };
  }
  const separator = trimmed.indexOf(":");
  const prefix = separator === -1 ? "" : trimmed.slice(0, separator).trim().toLowerCase();
  const value = separator === -1 ? "" : trimmed.slice(separator + 1).trim();
  if (prefix === "account" && value) {
    const { account, error } = await resolveAccountParam(value, "required");
    if (!account) return { error: error ?? `No connected account matches "${value}".` };
    return { accountId: account.id, contactId: null, label: account.name };
  }
  if (prefix === "contact" && value) {
    const contactId = value.toLowerCase();
    return { accountId: null, contactId, label: contactId };
  }
  return {
    error: `Unrecognized scope "${trimmed}" — use "general", "account:<address>" or "contact:<address>".`,
  };
}

const SCOPE_FORMS =
  `"general" (applies everywhere), "account:<address>" (one connected account) or ` +
  `"contact:<address>" (one correspondent)`;

const SCOPE_PARAM = Type.Optional(
  Type.String({
    description:
      `Where the page applies; omit for pages that apply everywhere. "account:<address>" ` +
      `scopes it to that connected account (a client of one company, a per-inbox rule, that ` +
      `account's writing style) so it only surfaces when acting as that account; ` +
      `"contact:<address>" scopes it to one correspondent (their tone, preferences, ` +
      `background) so it only surfaces when corresponding with them.`,
  }),
);

const TYPE_PARAM = Type.Optional(
  Type.String({
    description:
      `Optional page kind ("person", "company", "deal", "recipe", "style", "skill"). ` +
      `"skill" is special: the page becomes a playbook, always listed in the Skills index, ` +
      `and its name never changes on edit.`,
  }),
);

const WIKI_CARD_NOTE = cardNote(
  "what you saved as a chip in the conversation",
  "A word that you noted it is enough; don't repeat the page back.",
);

const pageWrite: AgentTool = tool({
  name: "page_write",
  label: "Write wiki page",
  description:
    `Save a NEW page to your wiki — your long-term memory. ALWAYS check the wiki listing in ` +
    `your system prompt first: if any existing page can absorb the new information (same ` +
    `person, company, deal or topic, or a broader rule it fits under), rewrite that page with ` +
    `page_update instead — page_write is only for subjects no existing page covers. One page ` +
    `per entity or topic. A page is summary + body, split at the first blank line: the summary ` +
    `rides your system prompt in every future conversation, so lead with the standing facts, ` +
    `terse; put longer-form material — correspondent background, thread history, research — ` +
    `after a blank line as the body, which stays on disk behind page_read. Do not save one-off ` +
    `task details or whole emails. Omit name to derive the page's id from the content; pass ` +
    `name to choose it (short kebab-case) — a named write replaces that page if it exists, so ` +
    `read it first. For a skill (a reusable playbook for how the user wants a recurring task ` +
    `done — "always do it like this", "from now on when I ask for X…"), pass a name and type ` +
    `"skill": the summary says when it applies, the body is the complete instructions a future ` +
    `session will follow. The user sees and edits all pages on the Knowledge page.`,
  params: {
    content: Type.String({
      description:
        "The page: a terse summary paragraph of standing facts first; optionally a blank " +
        "line and the longer-form body.",
    }),
    name: Type.Optional(
      Type.String({
        description:
          'Chosen page id (short kebab-case, e.g. "max-mustermann", "market-report"). ' +
          "Required for skills; omit elsewhere to derive it from the content.",
      }),
    ),
    type: TYPE_PARAM,
    scope: SCOPE_PARAM,
  },
  catchToText: true,
  execute: async ({ content, name, type, scope }) => {
    let target: PageScope = { accountId: null, contactId: null, label: "general" };
    if (scope?.trim()) {
      const resolved = await resolvePageScope(scope);
      if ("error" in resolved) return textResult(resolved.error);
      target = resolved;
    }
    const attrs = { type, accountId: target.accountId, contactId: target.contactId };
    if (name?.trim()) {
      const page = await writeNamedPage(name, content, "agent", attrs);
      return textResult(
        `Saved wiki page [${page.id}] (${target.label}).${WIKI_CARD_NOTE}`,
        buildWikiNoteCard({ pageId: page.id, content: page.content, pageType: page.type }),
      );
    }
    const { page, created } = await createPage(content, "agent", attrs);
    return textResult(
      created
        ? `Saved wiki page [${page.id}] (${target.label}).${WIKI_CARD_NOTE}`
        : `Already in the wiki as [${page.id}] (${target.label}).`,
      created
        ? buildWikiNoteCard({ pageId: page.id, content: page.content, pageType: page.type })
        : undefined,
    );
  },
});

const pageUpdate: AgentTool = tool({
  name: "page_update",
  label: "Update wiki page",
  description:
    `Update one wiki page: when a fact has changed or the user corrects it, and when new ` +
    `information belongs to an entity or topic a page already covers — extend that page ` +
    `rather than writing a second one. Pass the page's full replacement content (summary ` +
    `paragraph first, body after a blank line). Use the id shown in brackets in the wiki ` +
    `listing in your system prompt; read the page first with page_read when its body is on ` +
    `disk. Pass scope to move the page — ${SCOPE_FORMS} — or omit it to keep the current ` +
    `scope; same for type.`,
  params: {
    id: Type.String({
      description: "The page id (the bracketed id from the wiki listing).",
    }),
    content: Type.String({
      description:
        "The page's full replacement content — the existing facts (minus anything obsolete) " +
        "plus the correction or addition.",
    }),
    type: TYPE_PARAM,
    scope: SCOPE_PARAM,
  },
  catchToText: true,
  execute: async ({ id, content, type, scope }) => {
    let accountId: string | null | undefined;
    let contactId: string | null | undefined;
    if (scope?.trim()) {
      const resolved = await resolvePageScope(scope);
      if ("error" in resolved) return textResult(resolved.error);
      accountId = resolved.accountId;
      contactId = resolved.contactId;
    }
    // Read first: the card shows what the rewrite changed, which needs the
    // page as it stood before it.
    const before = await readPage(id);
    const page = await updatePage(id, content, { type, accountId, contactId });
    if (!page) {
      return textResult(`No wiki page ${id} — use the id from the wiki listing.`);
    }
    return textResult(
      `Wiki page updated: [${page.id}].${WIKI_CARD_NOTE}`,
      buildWikiNoteCard({
        pageId: page.id,
        content: page.content,
        pageType: page.type,
        updated: true,
        before: before?.content,
      }),
    );
  },
});

const pageDelete: AgentTool = tool({
  name: "page_delete",
  label: "Delete wiki page",
  description:
    `Delete one wiki page. Use only when the user asks to forget something or a page is ` +
    `clearly obsolete — not to make room for an update, use page_update for that. Use the id ` +
    `shown in brackets in the wiki listing in your system prompt.`,
  params: {
    id: Type.String({
      description: "The page id (the bracketed id from the wiki listing).",
    }),
  },
  execute: async ({ id }) => {
    const deleted = await deletePage(id);
    if (!deleted) {
      return textResult(`No wiki page ${id} — use the id from the wiki listing.`);
    }
    return textResult(`Wiki page deleted.`);
  },
});

const pageRead: AgentTool = tool({
  name: "page_read",
  label: "Read wiki page",
  description:
    `Read one wiki page in full — summary and body. Use it before following a skill, before ` +
    `updating a page whose body is on disk, and to read a page listed index-only in your ` +
    `system prompt before relying on it.`,
  params: {
    id: Type.String({
      description: "The page id (bracketed in the wiki listing, or the skill's name).",
    }),
  },
  execute: async ({ id }) => {
    const page = await readPage(id);
    if (!page) {
      return textResult(
        `No wiki page ${id} — use an id from the wiki listing in your system prompt, or ` +
          `file_ls wiki/.`,
      );
    }
    const scope =
      page.accountId !== null
        ? ` — account-scoped`
        : page.contactId !== null
          ? ` — about ${page.contactId}`
          : "";
    const kind = page.type ? ` (${page.type})` : "";
    return textResult(`Wiki page [${page.id}]${kind}${scope}:\n\n${page.content}`);
  },
});

const pageUsed: AgentTool = tool({
  name: "page_used",
  label: "Note wiki pages used",
  description:
    `Record which wiki pages you actually relied on this turn — pass the bracketed ids (from ` +
    `the wiki listing in your system prompt) of every page whose content shaped your reply, ` +
    `draft, or decision. Call it once, at the end of the turn, and only for pages you ` +
    `genuinely used — not every page shown, and skip it entirely when none was relevant. It ` +
    `has no user-visible effect; it keeps a used page from decaying out of your prompt and ` +
    `tracks which pages earn their place.`,
  params: {
    ids: Type.Array(Type.String(), {
      description: "Bracketed ids of the pages you relied on this turn.",
    }),
  },
  execute: async ({ ids }) => {
    const recorded = await recordPageUse(ids);
    return textResult(
      recorded.length > 0
        ? `Noted ${recorded.length} page${recorded.length === 1 ? "" : "s"} as used.`
        : "No matching wiki pages to note.",
    );
  },
});

const libraryList: AgentTool = tool({
  name: "library_list",
  label: "List library documents",
  description:
    `List every document in the user's local library (files they dropped into the library ` +
    `folder or uploaded in Settings). Returns each document's title and id for library_read.`,
  params: {},
  execute: async () => {
    const documents = await listDocuments();
    if (documents.length === 0) {
      return textResult(
        `The library is empty. The user can drop ${SUPPORTED_FORMATS} files into ` +
          `${getLibraryDir()} (or upload them on the Knowledge page).`,
      );
    }
    const lines = documents.map((d) => {
      const state =
        d.status === "error"
          ? ` — indexing failed: ${d.error ?? "unknown error"}`
          : `, ${Math.max(1, Math.ceil(d.chunkCount / PART_CHUNKS))} part(s)`;
      return `- ${d.title} (${d.ext}, ${formatFileSize(d.size)}${state}) — id: ${d.id}`;
    });
    return textResult(lines.join("\n"));
  },
});

const librarySearch: AgentTool = tool({
  name: "library_search",
  label: "Search library",
  description:
    `Keyword search across the user's local document library (PDFs, Word files, dropped ` +
    `documents). Returns matching passages with their document id and part number — read the ` +
    `full context with library_read. Use distinctive keywords from the question; if nothing ` +
    `matches, retry with synonyms or fewer terms. Your own wiki pages are not in here — ` +
    `search those with file_grep on wiki/.`,
  params: {
    query: Type.String({ description: "Search terms (keywords, not a sentence)." }),
    limit: Type.Optional(Type.Number({ description: "Max results, 1–20 (default 8)." })),
  },
  execute: async ({ query, limit: limitRaw }) => {
    const limit = clampLimit(limitRaw, 8, 20);
    const hits = searchChunks(query, limit);
    if (hits.length === 0) {
      return textResult(`No matches for "${query}". Try other keywords, or library_list.`);
    }
    const lines = hits.map(
      (h) =>
        `[${h.title} — part ${Math.floor(h.seq / PART_CHUNKS) + 1}, id: ${h.documentId}]\n${h.snippet}`,
    );
    return textResult(lines.join("\n\n"));
  },
});

const libraryRead: AgentTool = tool({
  name: "library_read",
  label: "Read library document",
  description:
    `Read a document from the user's library by id (from library_search or library_list). ` +
    `Long documents come in parts of ~15k characters — pass "part" to continue reading.`,
  params: {
    documentId: Type.String({ description: "The document id." }),
    part: Type.Optional(Type.Number({ description: "1-based part to read (default 1)." })),
  },
  execute: async ({ documentId, part }) => {
    const doc = await getDocument(documentId);
    if (!doc) return textResult(`No document with id ${documentId} — check library_list.`);
    if (doc.status === "error") {
      return textResult(`"${doc.title}" could not be indexed: ${doc.error ?? "unknown error"}.`);
    }
    const chunks = readDocumentChunks(documentId);
    const totalParts = Math.max(1, Math.ceil(chunks.length / PART_CHUNKS));
    const wanted = Math.max(1, Math.min(totalParts, Math.round(part ?? 1)));
    const body = chunks.slice((wanted - 1) * PART_CHUNKS, wanted * PART_CHUNKS).join("");
    const header =
      `${doc.title} (${doc.path}) — part ${wanted}/${totalParts}` +
      (wanted < totalParts ? ` — call again with part: ${wanted + 1} for more` : "");
    return textResult(`${header}\n\n${body || "(empty document)"}`);
  },
});

export function buildWikiTools(): AgentTool[] {
  return [
    pageWrite,
    pageUpdate,
    pageDelete,
    pageRead,
    pageUsed,
    libraryList,
    librarySearch,
    libraryRead,
  ];
}

/**
 * Read-only subset for background workers and unattended runs: unattended
 * sessions reading attacker-controlled mail must not be able to plant a page
 * (or a skill) that later sessions would trust. page_used is included though
 * it mutates: it only bumps a usage counter, so it can't inject
 * attacker-controlled content into a later prompt the way page_write could.
 */
export function buildWikiReadTools(): AgentTool[] {
  return [pageRead, pageUsed, libraryList, librarySearch, libraryRead];
}

/** Caps library titles in the system prompt so it can't grow unbounded. */
const LIBRARY_TOC_LIMIT = 100;

/**
 * A page as the prompt carries it: the summary, plus a pointer whenever the
 * page holds more than the prompt shows. Pages are files the user and the
 * agent can also write from outside the app, so the summary length is
 * enforced here on the way in, not only in the store: one hand-edited file
 * cannot take the block over on its own.
 */
function pageText(page: WikiPage): string {
  const { summary, body } = splitPage(page.content);
  if (summary.length > WIKI_SUMMARY_MAX_LENGTH) {
    return `${summary.slice(0, WIKI_SUMMARY_MAX_LENGTH)}\n[Cut off here — page_read ${page.id} for the whole page.]`;
  }
  return body ? `${summary}\n[+ body on disk — page_read ${page.id} for the rest.]` : summary;
}

/** One page as it is rendered into the block; also what it costs the budget. */
function pageLine(page: WikiPage): string {
  const text = pageText(page);
  return text.includes("\n")
    ? `- [${page.id}]\n  ${text.split("\n").join("\n  ")}`
    : `- [${page.id}] ${text}`;
}

/** Which section a page renders under; a new key costs its header too. */
function pageScope(page: WikiPage): string {
  if (page.accountId !== null) return `account:${page.accountId}`;
  if (page.contactId !== null) return `contact:${page.contactId}`;
  return "global";
}

/**
 * The pages the prompt can carry, in two tiers over one
 * most-recently-touched-first order (touched = saved, updated, or relied on
 * via page_used; each rewrites the file): full summaries while the budget
 * lasts, then one-line index entries for what no longer fits, so a decayed
 * page stays discoverable instead of vanishing behind a count. The index
 * reserve is ceded only once pages actually overflow; a wiki that fits in
 * full never pays for it. The count cap bounds both tiers together against a
 * folder holding more files than createPage would allow. Costed on the
 * rendered text, headers included, so the block really does fit. Nothing is
 * deleted: what not even the index fits stays on disk, and the file tools
 * still reach it. Both lists return in the caller's original order.
 */
function withinWikiBudget(
  pages: WikiPage[],
  budget: number,
  headerCost: (scope: string) => number,
  indexLine: (page: WikiPage) => string,
): { shown: WikiPage[]; indexed: WikiPage[]; omitted: number } {
  const byTouch = [...pages].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const fill = (limit: number): { ids: Set<string>; used: number } => {
    const ids = new Set<string>();
    const scopesSeen = new Set<string>();
    let used = 0;
    for (const page of byTouch) {
      if (ids.size >= WIKI_PAGE_MAX_COUNT) break;
      const scope = pageScope(page);
      // +1 for the newline joining this line to the previous one.
      let cost = pageLine(page).length + 1;
      if (!scopesSeen.has(scope)) cost += headerCost(scope);
      if (used + cost > limit) break;
      used += cost;
      scopesSeen.add(scope);
      ids.add(page.id);
    }
    return { ids, used };
  };

  let full = fill(budget);
  const indexIds = new Set<string>();
  if (full.ids.size < Math.min(byTouch.length, WIKI_PAGE_MAX_COUNT)) {
    full = fill(Math.max(0, budget - WIKI_INDEX_RESERVE));
    let used = full.used + WIKI_INDEX_HEADER.length;
    for (const page of byTouch) {
      if (full.ids.has(page.id)) continue;
      if (full.ids.size + indexIds.size >= WIKI_PAGE_MAX_COUNT) break;
      const cost = indexLine(page).length + 1;
      if (used + cost > budget) break;
      used += cost;
      indexIds.add(page.id);
    }
  }
  return {
    shown: pages.filter((page) => full.ids.has(page.id)),
    indexed: pages.filter((page) => indexIds.has(page.id)),
    omitted: pages.length - full.ids.size - indexIds.size,
  };
}

const WIKI_BLOCK_HEADER =
  "\n\nLong-term memory — your wiki, one page per entity or topic (the user manages pages on the Knowledge page). Page summaries follow; a page with more on disk says so:\n";

const WIKI_BLOCK_FOOTER =
  "\n\nWhen one of these pages shapes your reply, draft, or decision this turn, call page_used at the end with the bracketed id(s) of the ones you actually relied on — only those, and skip the call when none were relevant. That includes an index entry you read from disk; relying on it is what promotes it back into full view.";

const WIKI_INDEX_HEADER = "\n\nOlder pages, index only — page_read one before relying on it:\n";

/**
 * Room ceded to the index tier once pages overflow the full tier: about
 * sixty index lines. Never charged while everything fits in full.
 */
const WIKI_INDEX_RESERVE = 6_000;

/** An index line carries the page's first line, clipped to this. */
const WIKI_INDEX_SNIPPET = 80;

/**
 * What the block costs before a single page: its framing, plus the note that
 * appears when pages had to be left out. Charged up front so the budget the
 * pages are measured against is the room they will actually have.
 */
function wikiFramingCost(): number {
  return WIKI_BLOCK_HEADER.length + WIKI_BLOCK_FOOTER.length + omittedNote(1, 9_999).length;
}

/** The housekeeping note once the wiki no longer fits in full; "" while it does. */
function omittedNote(indexed: number, omitted: number): string {
  if (indexed === 0 && omitted === 0) return "";
  // The wiki outgrowing its share is the agent's own housekeeping: it wrote
  // most of these, and it is the only thing positioned to tell which of them
  // are now the same fact said twice. Stated as work to do, since nothing else will do it.
  const decayed =
    indexed === 0
      ? ""
      : "the least recently saved, updated or relied-on pages decay into the index above, still whole on disk but no longer read to you in full.";
  const unlisted =
    omitted === 0
      ? ""
      : `${omitted} further ${omitted === 1 ? "page is" : "pages are"} saved but not shown at all — list them with file_ls under wiki/, read one with page_read.`;
  return `\n\nThe wiki has outgrown the room it gets in this prompt: ${[decayed, unlisted].filter(Boolean).join(" ")} Tidy up when you next write or update a page: merge pages covering the same entity or topic into one with page_update, and delete with page_delete what has been superseded or no longer holds. Fewer, fuller pages are the goal, never a longer list.`;
}

/**
 * The wiki and the library index, held to `budget` characters between them
 * (the share of the system prompt's ceiling left over by prompt.ts). Skill
 * pages have their own section (buildSkillsContext) and are left out here.
 * The library index is measured first: it is already bounded by
 * LIBRARY_TOC_LIMIT, and the wiki is the section that grows without one.
 */
export async function buildWikiContext(budget: number): Promise<string> {
  const library = await buildLibraryContext();

  const all = (await listPages()).filter((page) => page.type !== WIKI_TYPE_SKILL);
  const names = await fetchAccountNameMap();
  const scopeHeader = (scope: string): string => {
    if (scope === "global") return "";
    const [kind, ...rest] = scope.split(":");
    const id = rest.join(":");
    return kind === "account"
      ? `Pages for ${names.get(id) ?? id} (apply only when reading or writing as this account):\n`
      : `Pages about ${id} (apply only when corresponding with them):\n`;
  };

  const indexLine = (page: WikiPage): string => {
    const first = splitPage(page.content).summary.split("\n", 1)[0] ?? "";
    const snippet =
      first.length > WIKI_INDEX_SNIPPET ? `${first.slice(0, WIKI_INDEX_SNIPPET)}…` : first;
    const scope = pageScope(page);
    const tag =
      scope === "global"
        ? ""
        : page.accountId !== null
          ? ` (account: ${names.get(page.accountId) ?? page.accountId})`
          : ` (contact: ${page.contactId})`;
    return `- [${page.id}] ${snippet}${tag}`;
  };

  const pageBudget = Math.max(0, budget - library.length - wikiFramingCost());
  const {
    shown: pages,
    indexed,
    omitted,
  } = withinWikiBudget(
    all,
    pageBudget,
    // +2 for the blank line separating this section from the previous one.
    (scope) => scopeHeader(scope).length + 2,
    indexLine,
  );
  if (pages.length === 0 && indexed.length === 0) return library;

  // Multi-line summaries render as an id line with the text indented beneath
  // it, so a page stays one list item.
  const format = (list: WikiPage[]) => list.map(pageLine).join("\n");

  const global = pages.filter((p) => p.accountId === null && p.contactId === null);
  const accountScoped = pages.filter((p) => p.accountId !== null);
  const contactScoped = pages.filter((p) => p.contactId !== null);

  const sections: string[] = [];
  if (global.length > 0) sections.push(format(global));
  for (const [accountId, group] of groupBy(accountScoped, (p) => p.accountId as string)) {
    sections.push(scopeHeader(`account:${accountId}`) + format(group));
  }
  for (const [address, group] of groupBy(contactScoped, (p) => p.contactId as string)) {
    sections.push(scopeHeader(`contact:${address}`) + format(group));
  }

  const index = indexed.length === 0 ? "" : WIKI_INDEX_HEADER + indexed.map(indexLine).join("\n");

  return (
    WIKI_BLOCK_HEADER +
    sections.join("\n\n") +
    index +
    omittedNote(indexed.length, omitted) +
    WIKI_BLOCK_FOOTER +
    library
  );
}

/** A skill index line is a summary, not the skill; the body is what page_read is for. */
const SKILL_DESCRIPTION_MAX_CHARS = 300;

/**
 * System-prompt skills index from the wiki's skill-typed pages: id + one
 * summary line only; the body is left to page_read since every entry rides on
 * every turn. Skills are files the user can also write from outside the app,
 * so the index is held to `budget` characters: entries past it are counted,
 * so the section can never outgrow its share of the prompt.
 */
export async function buildSkillsContext(budget: number): Promise<string> {
  const skills = (await listPages()).filter((page) => page.type === WIKI_TYPE_SKILL);
  if (skills.length === 0) return "";
  const header =
    `\n\nSkills — the user's saved playbooks for how they want recurring tasks done. When a ` +
    `request matches one, read it with page_read and follow it:\n`;

  // Too little room for a header and a line or two: the section would cost the
  // conversation more than the stub is worth.
  if (budget < header.length + 200) return "";

  const lines: string[] = [];
  let used = header.length;
  for (const skill of skills) {
    const summary = splitPage(skill.content).summary.split("\n", 1)[0] ?? "";
    const line = `- ${skill.id}: ${summary.slice(0, SKILL_DESCRIPTION_MAX_CHARS)}`;
    const rest = `… and ${skills.length - lines.length} more, listed on the Knowledge page.`;
    // Room for this line AND the note that would replace the remainder, so the
    // last line never pushes the section over.
    if (used + line.length + rest.length + 2 > budget) {
      lines.push(rest);
      break;
    }
    used += line.length + 1;
    lines.push(line);
  }
  return header + lines.join("\n");
}

/** The library index: already bounded by LIBRARY_TOC_LIMIT titles, one line each. */
async function buildLibraryContext(): Promise<string> {
  const indexed = (await listDocuments()).filter((d) => d.status === "indexed" && d.chunkCount > 0);
  if (indexed.length === 0) return "";
  const shown = indexed.slice(0, LIBRARY_TOC_LIMIT);
  const lines = shown.map((d) => `- ${d.title} (${d.ext})`);
  if (indexed.length > shown.length) {
    lines.push(`… and ${indexed.length - shown.length} more — use library_list.`);
  }
  return `\n\nDocument library (search with library_search, read with library_read):\n${lines.join("\n")}`;
}
