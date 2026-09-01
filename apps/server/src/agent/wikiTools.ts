import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  formatFileSize,
  splitPage,
  WIKI_SUMMARY_MAX_LENGTH,
  WIKI_TYPE_SKILL,
  type WikiPage,
} from "@marlen/shared";
import { Type } from "@sinclair/typebox";
import { slugify } from "../core/utils/util.js";
import { getLibraryDir, SUPPORTED_FORMATS } from "../storage/library/ingest.js";
import {
  getDocument,
  listDocuments,
  readDocumentChunks,
  searchChunks,
} from "../storage/library/store.js";
import { overlappingPage, searchPages } from "../storage/wiki/search.js";
import {
  createPage,
  deletePage,
  listPages,
  readPage,
  recordPageUse,
  updatePage,
  WikiPageConflictError,
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
    `Save a NEW page to your wiki — your long-term memory. First check whether a page already ` +
    `covers the subject (the wiki listing in your system prompt, or page_search): if one does ` +
    `(same person, company, deal or topic, or a broader rule it fits under), extend it with ` +
    `page_update instead. One page per entity or topic, named after that subject (short ` +
    `kebab-case: "max-mustermann", "maier-gmbh", "market-report"); the id never changes ` +
    `afterwards, so choose the name for the subject, not for today's fact. A page is summary + ` +
    `body, split at the first blank line: the summary rides your system prompt in every future ` +
    `conversation, so lead with the standing facts, terse; put longer-form material — ` +
    `correspondent background, thread history, research — after a blank line as the body, ` +
    `which stays on disk behind page_read. Do not save one-off task details or whole emails. ` +
    `A name already in use must be changed with page_update after reading it. For a skill (a reusable ` +
    `playbook for how the user wants a recurring task done — "always do it like this", "from ` +
    `now on when I ask for X…"), pass a name and type "skill": the summary says when it ` +
    `applies, the body is the complete instructions a future session will follow. The user ` +
    `sees and edits all pages on the Knowledge page.`,
  params: {
    content: Type.String({
      description:
        "The page: a terse summary paragraph of standing facts first; optionally a blank " +
        "line and the longer-form body.",
    }),
    name: Type.Optional(
      Type.String({
        description:
          'The page id, named after its subject (short kebab-case, e.g. "max-mustermann", ' +
          '"market-report"). Required for skills; omitted only for a standalone fact with no ' +
          "subject of its own, whose id is then derived from the text.",
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
      const id = slugify(name);
      const existing = id ? await readPage(id) : null;
      if (existing) {
        return textResult(
          `Not saved: wiki page [${existing.id}] already exists. Read it with page_read, then ` +
            "use page_update with its revision so a newer human edit cannot be overwritten.",
        );
      }
      const page = await writeNamedPage(name, content, "agent", attrs);
      return textResult(
        `Saved wiki page [${page.id}] (${target.label}).${WIKI_CARD_NOTE}`,
        buildWikiNoteCard({ pageId: page.id, content: page.content, pageType: page.type }),
      );
    }
    // An unnamed write that reads like an existing page's summary is almost
    // always the same subject again; a deliberate second page passes a name.
    const twin = overlappingPage(
      (await listPages()).filter(
        (p) => p.accountId === target.accountId && p.contactId === target.contactId,
      ),
      content,
    );
    if (twin) {
      return textResult(
        `Not saved: [${twin.id}] already covers this subject — "${firstLine(twin.content)}". ` +
          `Extend it with page_update (page_read it first when its body is on disk), or pass a ` +
          `name to save a distinct page on purpose.`,
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
    `paragraph first, body after a blank line). Read the page first with page_read and pass ` +
    `the revision it returns, so a newer edit cannot be overwritten. Pass scope to move the ` +
    `page — ${SCOPE_FORMS} — or omit it to keep the current scope; same for type.`,
  params: {
    id: Type.String({
      description: "The page id (the bracketed id from the wiki listing).",
    }),
    content: Type.String({
      description:
        "The page's full replacement content — the existing facts (minus anything obsolete) " +
        "plus the correction or addition.",
    }),
    baseRevision: Type.String({
      description: "The revision returned by the page_read used to prepare this replacement.",
    }),
    type: TYPE_PARAM,
    scope: SCOPE_PARAM,
  },
  catchToText: true,
  execute: async ({ id, content, baseRevision, type, scope }) => {
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
    let page: WikiPage | null;
    try {
      page = await updatePage(id, content, { type, accountId, contactId }, { baseRevision });
    } catch (error) {
      if (error instanceof WikiPageConflictError) {
        return textResult(
          `Wiki page [${error.current.id}] changed — page_read it again before updating.`,
        );
      }
      throw error;
    }
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

/** A page's first summary line, the label the tools use for it. */
function firstLine(content: string): string {
  return splitPage(content).summary.split("\n", 1)[0] ?? "";
}

function scopeTag(page: WikiPage, names: Map<string, string>): string {
  if (page.accountId !== null) return ` (account: ${names.get(page.accountId) ?? page.accountId})`;
  if (page.contactId !== null) return ` (contact: ${page.contactId})`;
  return "";
}

/** One search hit as the tools and the turn note list it. */
function hitLine(page: WikiPage, names: Map<string, string>): string {
  const first = firstLine(page.content);
  const snippet =
    first.length > WIKI_INDEX_SNIPPET ? `${first.slice(0, WIKI_INDEX_SNIPPET)}…` : first;
  const kind = page.type ? ` (${page.type})` : "";
  const more = splitPage(page.content).body ? " [+ body]" : "";
  return `- [${page.id}]${kind}${scopeTag(page, names)} ${snippet}${more}`;
}

const pageSearch: AgentTool = tool({
  name: "page_search",
  label: "Search wiki",
  description:
    `Keyword search over every page of your wiki, including the ones your system prompt lists ` +
    `only as an index or not at all. Use it whenever a person, company, address, deal or topic ` +
    `comes up that the listed summaries don't obviously cover, and before writing a new page. ` +
    `Returns matching pages with their first line; page_read one for the whole page.`,
  params: {
    query: Type.String({
      description: "Names, addresses or keywords (not a sentence).",
    }),
    limit: Type.Optional(Type.Number({ description: "Max results, 1–20 (default 8)." })),
  },
  execute: async ({ query, limit: limitRaw }) => {
    const hits = searchPages(await listPages(), query, clampLimit(limitRaw, 8, 20));
    if (hits.length === 0) return textResult(`No wiki page matches "${query}".`);
    const names = await fetchAccountNameMap();
    return textResult(hits.map((hit) => hitLine(hit.page, names)).join("\n"));
  },
});

const pageRead: AgentTool = tool({
  name: "page_read",
  label: "Read wiki page",
  description:
    `Read one wiki page in full — summary and body. Use it before following a skill, before ` +
    `updating a page whose body is on disk, and to read a page listed index-only in your ` +
    `system prompt before relying on it. Reading counts as using the page.`,
  params: {
    id: Type.String({
      description: "The page id (bracketed in the wiki listing, or the skill's name).",
    }),
  },
  execute: async ({ id }) => {
    const page = await readPage(id);
    if (!page) {
      return textResult(`No wiki page ${id} — find the page with page_search.`);
    }
    await recordPageUse([page.id]);
    const scope =
      page.accountId !== null
        ? ` — account-scoped`
        : page.contactId !== null
          ? ` — about ${page.contactId}`
          : "";
    const kind = page.type ? ` (${page.type})` : "";
    return textResult(
      `Wiki page [${page.id}]${kind}${scope} (revision ${page.revision}):\n\n${page.content}`,
    );
  },
});

const pageUsed: AgentTool = tool({
  name: "page_used",
  label: "Note wiki pages used",
  description:
    `Note which of the wiki summaries listed in your system prompt shaped your reply, draft ` +
    `or decision this turn, by bracketed id. Pages you page_read are counted already. Skip it ` +
    `when no listed summary mattered. It has no user-visible effect beyond the "used" marks ` +
    `on the Knowledge page and the reply's memory attribution.`,
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
    `page_search covers those.`,
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
    pageSearch,
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
  return [pageSearch, pageRead, pageUsed, libraryList, librarySearch, libraryRead];
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

/** One pinned page as it is rendered into the block. */
function pageLine(page: WikiPage, names: Map<string, string>): string {
  const text = pageText(page);
  const kind = page.type ? ` (${page.type})` : "";
  const label = `[${page.id}]${kind}${scopeTag(page, names)}`;
  return text.includes("\n")
    ? `- ${label}\n  ${text.split("\n").join("\n  ")}`
    : `- ${label} ${text}`;
}

const WIKI_BLOCK_HEADER =
  "\n\nLong-term memory — one stable page per entity or topic. Pinned summaries are always loaded; the rest are an index and matching summaries are attached to each turn:\n";

const WIKI_BLOCK_FOOTER =
  "\n\nUse page_search when the index suggests relevant memory but the current turn did not attach it. page_read loads a page's full body.";

const WIKI_PINNED_HEADER = "\nPinned summaries:\n";
const WIKI_INDEX_HEADER = "\nPage index:\n";

/** An index line carries the page's first line, clipped to this. */
const WIKI_INDEX_SNIPPET = 80;

/**
 * The note for pages the prompt has no room to index; "" while every page is listed.
 */
function omittedNote(omitted: number): string {
  if (omitted === 0) return "";
  return `\n\n${omitted} further ${omitted === 1 ? "page is" : "pages are"} saved but not listed here; page_search finds them.`;
}

/**
 * The wiki and the library index, held to `budget` characters between them
 * (the share of the system prompt's ceiling left over by prompt.ts). Skill
 * pages have their own section (buildSkillsContext) and are left out here.
 * The library index is measured first: it is already bounded by
 * LIBRARY_TOC_LIMIT, and the wiki is the section that grows without one.
 */
export async function buildWikiContext(budget: number, pages?: WikiPage[]): Promise<string> {
  const library = await buildLibraryContext();
  const all = (pages ?? (await listPages()))
    .filter((page) => page.type !== WIKI_TYPE_SKILL)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (all.length === 0) return library;
  const names = await fetchAccountNameMap();
  const indexLine = (page: WikiPage): string => {
    const first = splitPage(page.content).summary.split("\n", 1)[0] ?? "";
    const snippet =
      first.length > WIKI_INDEX_SNIPPET ? `${first.slice(0, WIKI_INDEX_SNIPPET)}…` : first;
    const kind = page.type ? ` (${page.type})` : "";
    return `- [${page.id}]${kind}${scopeTag(page, names)} ${snippet}`;
  };

  const max = Math.max(0, budget - library.length);
  let used = WIKI_BLOCK_HEADER.length + WIKI_BLOCK_FOOTER.length;
  const pinnedLines: string[] = [];
  const fullyShown = new Set<string>();
  for (const page of all.filter((candidate) => candidate.pinned)) {
    const line = pageLine(page, names);
    const header = pinnedLines.length === 0 ? WIKI_PINNED_HEADER.length : 1;
    if (used + header + line.length > max) break;
    used += header + line.length;
    pinnedLines.push(line);
    fullyShown.add(page.id);
  }

  const indexLines: string[] = [];
  for (const page of all) {
    if (fullyShown.has(page.id)) continue;
    const line = indexLine(page);
    const header = indexLines.length === 0 ? WIKI_INDEX_HEADER.length : 1;
    if (used + header + line.length > max) break;
    used += header + line.length;
    indexLines.push(line);
  }
  if (pinnedLines.length === 0 && indexLines.length === 0) return library;
  const omitted = all.length - pinnedLines.length - indexLines.length;
  return (
    WIKI_BLOCK_HEADER +
    (pinnedLines.length > 0 ? WIKI_PINNED_HEADER + pinnedLines.join("\n") : "") +
    (indexLines.length > 0 ? WIKI_INDEX_HEADER + indexLines.join("\n") : "") +
    omittedNote(omitted) +
    WIKI_BLOCK_FOOTER +
    library
  );
}

const TURN_PAGES_LIMIT = 5;

/** Below this a match is one common word; listing it would only add noise to the turn. */
const TURN_PAGES_MIN_SCORE = 1;

/**
 * The wiki pages a turn's message points at, appended to the turn prompt so
 * a page represented only by an index line (or one that did not fit) still
 * reaches the agent when its subject comes up. Skills are included:
 * a message that matches one is the cue to follow it. "" when nothing
 * matches well enough to be worth the tokens.
 */
const relevantByConversation = new Map<string, string[]>();

export function consumeRelevantPageIds(conversationId: string): string[] {
  const ids = relevantByConversation.get(conversationId) ?? [];
  relevantByConversation.delete(conversationId);
  return ids;
}

export interface RelevantPageScope {
  accountIds?: readonly string[];
  contactIds?: readonly string[];
}

export async function relevantPagesNote(
  text: string,
  conversationId?: string,
  scope: RelevantPageScope = {},
): Promise<string> {
  const accountIds = new Set(scope.accountIds ?? []);
  const contactIds = new Set((scope.contactIds ?? []).map((id) => id.toLowerCase()));
  const pages = (await listPages()).filter((page) => {
    if (page.accountId !== null && !accountIds.has(page.accountId)) return false;
    if (page.contactId !== null && !contactIds.has(page.contactId)) return false;
    return true;
  });
  const hits = searchPages(pages, text, TURN_PAGES_LIMIT);
  const top = hits[0]?.score ?? 0;
  const strong = hits.filter((hit) => hit.score >= Math.max(top / 2, TURN_PAGES_MIN_SCORE));
  if (strong.length === 0) return "";
  const ids = strong.map((hit) => hit.page.id);
  await recordPageUse(ids);
  if (conversationId) relevantByConversation.set(conversationId, ids);
  const names = await fetchAccountNameMap();
  return (
    `\n\n[Relevant long-term memory (full bodies remain behind page_read):\n` +
    `${strong.map((hit) => pageLine(hit.page, names)).join("\n")}]`
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
export async function buildSkillsContext(budget: number, pages?: WikiPage[]): Promise<string> {
  const skills = (pages ?? (await listPages())).filter((page) => page.type === WIKI_TYPE_SKILL);
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
