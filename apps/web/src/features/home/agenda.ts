import { shortDateLabel, timeLabel } from "@/lib/dates";

/** Due-date arithmetic shared by the Home task rows and the due-date picker. */

export const DAY_MS = 86_400_000;

export function startOfDayMs(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** A date-only ISO ("2026-07-24") anchors to local midnight and shows no clock; a date-time keeps its time. */
export function parseDue(iso: string): { at: Date; dateOnly: boolean } {
  const trimmed = iso.trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  return { at: new Date(dateOnly ? `${trimmed}T00:00:00` : trimmed), dateOnly };
}

/** Local date-only ISO for a day-start ms, what the picker's day grid writes. */
export function dayIso(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** A due date as row text, flagged once its day has passed. */
export function dueChip(
  dueAt: string,
  lang: string,
  todayStart: number,
): { text: string; overdue: boolean } {
  const { at, dateOnly } = parseDue(dueAt);
  const overdue = startOfDayMs(at) < todayStart;
  const iso = at.toISOString();
  const date = shortDateLabel(iso, lang);
  return { text: dateOnly ? date : `${date}, ${timeLabel(iso, lang)}`, overdue };
}
