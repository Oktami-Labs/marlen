/** One changed line of a text rewrite, in the order it appears. */
export interface DiffRow {
  op: "+" | "-";
  text: string;
}

export interface TextDiff {
  added: number;
  removed: number;
  /** The changed lines, capped; empty when the change is too large to spell out. */
  rows: DiffRow[];
}

/** Past this many lines a side is only counted, not diffed: the table is O(n·m). */
const MAX_LINES = 300;

function lines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split("\n");
}

/**
 * Line-level diff of a rewrite, as the changed lines alone (no context). Both
 * sides are the same document seconds apart, so the changes are what the
 * reader needs; the unchanged bulk is already on screen.
 *
 * Classic LCS table, which is why both sides are bounded: the caller shows
 * this for documents a person wrote, not for machine output of any size.
 */
export function textDiff(before: string, after: string, maxRows = 40): TextDiff {
  const a = lines(before);
  const b = lines(after);
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return { added: b.length, removed: a.length, rows: [] };
  }

  // One flat row-major table of width b.length + 1: lcs(i, j) is the length of
  // the longest common subsequence of a[i:] and b[j:].
  const width = b.length + 1;
  const table = new Int32Array((a.length + 1) * width);
  const lcs = (i: number, j: number) => table[i * width + j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j] ? lcs(i + 1, j + 1) + 1 : Math.max(lcs(i + 1, j), lcs(i, j + 1));
    }
  }

  const rows: DiffRow[] = [];
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;
  const push = (op: DiffRow["op"], text: string) => {
    if (op === "+") added++;
    else removed++;
    if (text.trim() && rows.length < maxRows) rows.push({ op, text });
  };
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (lcs(i + 1, j) >= lcs(i, j + 1)) {
      push("-", a[i] ?? "");
      i++;
    } else {
      push("+", b[j] ?? "");
      j++;
    }
  }
  for (; i < a.length; i++) push("-", a[i] ?? "");
  for (; j < b.length; j++) push("+", b[j] ?? "");

  return { added, removed, rows };
}
