/**
 * Reading a mail address as a person. Providers hand back RFC 5322 values
 * ("Petra Wagner <petra@example.com>", or a bare address); every email surface
 * shows the human and keeps the raw address for the tooltip.
 */

export interface MailAddress {
  /** What to show: the display name, else a name read off the local part, else the bare address. */
  name: string;
  /** The address itself, "" when the value carries none. */
  address: string;
}

/** A local part that reads as a name once split on the usual separators. */
const NAME_LIKE = /^\p{L}+(?:[._-]\p{L}+)*$/u;

/** "sophie.wagner" → "Sophie Wagner", "t.berger" → "T. Berger"; null when it isn't a name. */
function nameFromLocalPart(local: string): string | null {
  if (!NAME_LIKE.test(local)) return null;
  return local
    .split(/[._-]/)
    .map((part) => {
      const word = part.charAt(0).toUpperCase() + part.slice(1);
      return word.length === 1 ? `${word}.` : word;
    })
    .join(" ");
}

export function parseAddress(value: string): MailAddress {
  const raw = value.trim();
  const angled = raw.match(/^(.*)<([^<>]*)>[^<>]*$/);
  const address = (angled?.[2] ?? raw).trim();
  const display = (angled?.[1] ?? "")
    .trim()
    .replace(/^"(.*)"$/s, "$1")
    .trim();
  const local = address.includes("@") ? address.slice(0, address.indexOf("@")) : "";
  return { name: display || (local && nameFromLocalPart(local)) || address || raw, address };
}

/**
 * Split a To/Cc value into single addresses. A display name may be quoted and
 * hold its own commas, so quotes and angle brackets suspend the separator.
 */
export function splitAddresses(value: string): string[] {
  const entries: string[] = [];
  let current = "";
  let quoted = false;
  let angled = false;
  for (const char of value) {
    if (char === '"') quoted = !quoted;
    else if (char === "<") angled = true;
    else if (char === ">") angled = false;
    else if (char === "," && !quoted && !angled) {
      if (current.trim()) entries.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) entries.push(current.trim());
  return entries;
}

/** Display names for a header line; the user's own inbox collapses to `meLabel`. */
export function recipientNames(
  addresses: string[],
  self: string | undefined,
  meLabel: string,
): string[] {
  const own = self?.trim().toLowerCase();
  return addresses.flatMap((entry) => {
    const parsed = parseAddress(entry);
    if (!parsed.name) return [];
    return [own && parsed.address.toLowerCase() === own ? meLabel : parsed.name];
  });
}

/** Up to two letters standing in for a person on their avatar mark. */
export function initials(name: string): string {
  const source = name.includes("@") ? name.slice(0, name.indexOf("@")) : name;
  const letters = source
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => [...word][0]?.toUpperCase() ?? "");
  return letters.join("") || "?";
}
