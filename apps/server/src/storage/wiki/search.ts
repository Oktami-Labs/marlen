import { splitPage, type WikiPage } from "@marlen/shared";

/**
 * Keyword retrieval over wiki pages, in memory: the folder holds at most a
 * thousand short pages, so a scan beats an index that must chase file edits.
 * A term matched in a page's summary or id outweighs one matched only in its
 * body, and rare terms outweigh common ones (idf over the pages at hand), so
 * "Weber" finds the Weber page while "email" finds nothing in particular.
 */

/** Trailing inflections dropped from tokens so plural and case forms meet. */
const SUFFIX = /(ungen|ung|en|er|es|e|s|n)$/;
const STEM_MIN_LENGTH = 4;

/**
 * Lowercased, diacritics folded, ß as ss, then crudely stemmed: suffixes
 * come off one at a time while the stem stays at least four characters, so
 * "Termine" and "Termin" both land on "termi" and "Weber" stays "weber".
 */
function normalizeToken(raw: string): string {
  let token = raw.toLowerCase().replace(/ß/g, "ss").normalize("NFD").replace(/\p{M}/gu, "");
  for (;;) {
    const stripped = token.replace(SUFFIX, "");
    if (stripped === token || stripped.length < STEM_MIN_LENGTH) return token;
    token = stripped;
  }
}

export function tokenize(text: string): string[] {
  return (text.match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((token) => token.length >= 2)
    .map(normalizeToken);
}

interface PageTerms {
  summary: Set<string>;
  body: Set<string>;
}

/** Keyed on the page object: the store hands out the same object until the file changes. */
const termCache = new WeakMap<WikiPage, PageTerms>();

function termsOf(page: WikiPage): PageTerms {
  const cached = termCache.get(page);
  if (cached) return cached;
  const { summary, body } = splitPage(page.content);
  const terms: PageTerms = {
    summary: new Set([...tokenize(page.id.replace(/-/g, " ")), ...tokenize(summary)]),
    body: new Set(tokenize(body)),
  };
  termCache.set(page, terms);
  return terms;
}

export interface PageHit {
  page: WikiPage;
  score: number;
}

/** Words this short (articles, pronouns, "wird") say nothing about a page's subject. */
const SUBJECT_TERM_MIN_LENGTH = 4;

function subjectTerms(terms: Set<string>): Set<string> {
  return new Set([...terms].filter((term) => term.length >= SUBJECT_TERM_MIN_LENGTH));
}

export interface SearchOptions {
  /**
   * Match subject words against id and summary only: what the query is
   * about, not every word a body happens to mention.
   */
  subjectOnly?: boolean;
}

/** A page whose contact scope appears verbatim in the query is what the query is about. */
const CONTACT_MATCH_SCORE = 6;
const SUMMARY_WEIGHT = 2;

export function searchPages(
  pages: WikiPage[],
  query: string,
  limit: number,
  { subjectOnly = false }: SearchOptions = {},
): PageHit[] {
  const tokens = new Set(tokenize(query));
  const terms = [...(subjectOnly ? subjectTerms(tokens) : tokens)];
  const lowered = query.toLowerCase();
  if (terms.length === 0 && !lowered.includes("@")) return [];
  const docs = pages.map((page) => ({ page, terms: termsOf(page) }));
  const inBody = (pageTerms: PageTerms, term: string): boolean =>
    !subjectOnly && pageTerms.body.has(term);
  const idf = new Map(
    terms.map((term) => {
      const df = docs.filter((d) => d.terms.summary.has(term) || inBody(d.terms, term)).length;
      return [term, df === 0 ? 0 : Math.log((docs.length + 1) / df)];
    }),
  );
  const hits: PageHit[] = [];
  for (const { page, terms: pageTerms } of docs) {
    let score = 0;
    for (const term of terms) {
      const weight = idf.get(term) ?? 0;
      if (weight === 0) continue;
      if (pageTerms.summary.has(term)) score += weight * SUMMARY_WEIGHT;
      else if (inBody(pageTerms, term)) score += weight;
    }
    if (page.contactId !== null && lowered.includes(page.contactId)) score += CONTACT_MATCH_SCORE;
    if (score > 0) hits.push({ page, score });
  }
  return hits
    .sort((a, b) => b.score - a.score || a.page.id.localeCompare(b.page.id))
    .slice(0, limit);
}

const OVERLAP_THRESHOLD = 0.6;

/**
 * The existing page whose summary shares most of its subject words with a
 * new page's summary, when that share is high enough to read as the same
 * subject written twice; null when no page comes close. Overlap is measured
 * against the smaller summary so a short new fact still matches a long
 * established page.
 */
export function overlappingPage(pages: WikiPage[], content: string): WikiPage | null {
  const candidate = subjectTerms(new Set(tokenize(splitPage(content).summary)));
  if (candidate.size < 2) return null;
  let best: { page: WikiPage; overlap: number } | null = null;
  for (const page of pages) {
    const existing = subjectTerms(termsOf(page).summary);
    if (existing.size < 2) continue;
    let shared = 0;
    for (const term of candidate) if (existing.has(term)) shared += 1;
    const overlap = shared / Math.min(candidate.size, existing.size);
    if (overlap >= OVERLAP_THRESHOLD && (best === null || overlap > best.overlap)) {
      best = { page, overlap };
    }
  }
  return best?.page ?? null;
}
