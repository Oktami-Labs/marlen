export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Filesystem- and prompt-safe identity: lowercase words joined by hyphens. */
export function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/**
 * True when every character can go in an HTTP header. A credential pasted with
 * decoration (a box-drawing rule, a smart quote) otherwise fails inside fetch
 * with a ByteString conversion error naming a character index, which tells the
 * user nothing.
 */
export function isHeaderSafe(value: string): boolean {
  return /^[\x20-\x7e]+$/.test(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
