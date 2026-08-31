import { type SQLWrapper, sql } from "drizzle-orm";

/** Escape SQL LIKE wildcards in user input so a literal `%` or `_` can't widen the match. */
function escapeLikeInput(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** `column LIKE '%…%' ESCAPE '\'`; the pattern is pre-escaped by escapeLikeInput. */
export function likePattern(column: SQLWrapper, pattern: string) {
  return sql`${column} LIKE ${pattern} ESCAPE '\\'`;
}

/** Wrap a LIKE-escaped value in `%` for use as likePattern's second argument. */
export function likeContains(value: string): string {
  return `%${escapeLikeInput(value)}%`;
}
