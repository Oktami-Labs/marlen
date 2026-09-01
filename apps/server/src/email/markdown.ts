import { styleAttribute } from "@marlen/shared";

/**
 * The markdown subset a draft body may use, rendered to the kind of HTML mail
 * clients actually honour: every element carries its own inline style, because
 * Outlook's Word renderer ignores stylesheets, and nothing outside this subset
 * is markup, so a body that happens to contain an asterisk stays literal.
 *
 * Deliberately small. A draft is prose someone is about to send, not a
 * document: emphasis, links, lists, quotes and inline code, nothing else.
 */

const LIST_STYLE = { margin: "0 0 12px", padding: "0 0 0 22px" } as const;
const QUOTE_STYLE = {
  margin: "0 0 12px",
  padding: "0 0 0 12px",
  "border-left": "2px solid #d9d9de",
  color: "#56565e",
} as const;
const CODE_STYLE = {
  "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace",
  "font-size": "0.95em",
} as const;

const BULLET = /^\s{0,3}[-*]\s+/;
const ORDERED = /^\s{0,3}\d+[.)]\s+/;
const QUOTED = /^\s{0,3}>\s?/;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Only http, https and mailto reach an href. A link target comes from the
 * model, so a `javascript:` or `data:` URL would otherwise ride into the
 * recipient's client; those render as their own link text instead.
 */
function safeHref(url: string): string | null {
  return /^(https?:|mailto:)/i.test(url.trim()) ? escapeHtml(url.trim()) : null;
}

/** Inline marks, applied to text that is already HTML-escaped. */
function inline(escaped: string): string {
  return (
    escaped
      // Code first: its content must not pick up emphasis marks.
      .replace(/`([^`\n]+)`/g, `<code style="${styleAttribute(CODE_STYLE)}">$1</code>`)
      .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, text: string, url: string) => {
        const href = safeHref(url);
        return href ? `<a href="${href}">${text}</a>` : match;
      })
      .replace(/\*\*(?=\S)([^*]+?)(?<=\S)\*\*/g, "<strong>$1</strong>")
      .replace(/__(?=\S)([^_]+?)(?<=\S)__/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*(?=\S)([^*\n]+?)(?<=\S)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>")
      .replace(/(^|[\s(])_(?=\S)([^_\n]+?)(?<=\S)_(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>")
  );
}

/** Lines of one paragraph, joined by the breaks the author typed. */
function paragraph(lines: string[], last: boolean): string {
  const style = styleAttribute({ margin: last ? "0" : "0 0 12px" });
  return `<p style="${style}">${lines.map((line) => inline(escapeHtml(line))).join("<br>")}</p>`;
}

function list(lines: string[], ordered: boolean): string {
  const items = lines
    .map((line) => `<li>${inline(escapeHtml(line.replace(ordered ? ORDERED : BULLET, "")))}</li>`)
    .join("");
  const tag = ordered ? "ol" : "ul";
  return `<${tag} style="${styleAttribute(LIST_STYLE)}">${items}</${tag}>`;
}

function quote(lines: string[]): string {
  const text = lines.map((line) => inline(escapeHtml(line.replace(QUOTED, "")))).join("<br>");
  return `<blockquote style="${styleAttribute(QUOTE_STYLE)}">${text}</blockquote>`;
}

/** Which block a line opens, so a run of like lines groups into one element. */
function kindOf(line: string): "bullet" | "ordered" | "quote" | "text" {
  if (BULLET.test(line)) return "bullet";
  if (ORDERED.test(line)) return "ordered";
  if (QUOTED.test(line)) return "quote";
  return "text";
}

export function markdownToHtml(source: string): string {
  const blocks: { kind: ReturnType<typeof kindOf>; lines: string[] }[] = [];
  for (const line of source.split("\n")) {
    // A blank line always closes the block; inside prose it is the paragraph break.
    if (!line.trim()) {
      if (blocks.length > 0 && blocks[blocks.length - 1]?.lines.length !== 0) {
        blocks.push({ kind: "text", lines: [] });
      }
      continue;
    }
    const kind = kindOf(line);
    const open = blocks[blocks.length - 1];
    if (open && open.kind === kind && open.lines.length > 0) open.lines.push(line);
    else blocks.push({ kind, lines: [line] });
  }

  const filled = blocks.filter((block) => block.lines.length > 0);
  return filled
    .map((block, index) => {
      const last = index === filled.length - 1;
      if (block.kind === "bullet") return list(block.lines, false);
      if (block.kind === "ordered") return list(block.lines, true);
      if (block.kind === "quote") return quote(block.lines);
      return paragraph(block.lines, last);
    })
    .join("");
}
