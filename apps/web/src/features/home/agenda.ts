import type { Automation, Todo } from "@marlen/shared";
import { timeLabel } from "@/lib/dates";

/** Due-date arithmetic shared by the Home agenda (rows + due-date picker). */

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

/** Local date-only ISO for a day-start ms, what a drag-to-reschedule writes. */
export function dayIso(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** A todo's due time in ms, or null when undated. */
export function dueMs(todo: Todo): number | null {
  return todo.dueAt ? parseDue(todo.dueAt).at.getTime() : null;
}

/** An approval without a date has waited this long before it counts as missed. */
const APPROVAL_PATIENCE_MS = 3 * DAY_MS;

/**
 * When an item needs the user, on the agenda's one time axis: its due time when
 * set; for an undated approval the moment it was drafted, which lands it in
 * Today until it has waited a few days and then under Missed; null for an
 * undated todo, which is Anytime.
 */
export function agendaMs(todo: Todo, todayStart: number): number | null {
  const due = dueMs(todo);
  if (due !== null || todo.kind !== "approval") return due;
  const drafted = new Date(todo.createdAt).getTime();
  return Date.now() - drafted > APPROVAL_PATIENCE_MS ? drafted : Math.max(drafted, todayStart);
}

export function dueChip(
  dueAt: string,
  lang: string,
  todayStart: number,
  { dayContext }: { dayContext: boolean },
): { text: string; overdue: boolean } {
  const { at, dateOnly } = parseDue(dueAt);
  const overdue = startOfDayMs(at) < todayStart;
  // Inside a day group the day is already the header, so a timed todo shows only its time.
  if (dayContext) return { text: dateOnly ? "" : timeLabel(at.toISOString(), lang), overdue };
  const date = at.toLocaleDateString(lang, { weekday: "short", day: "numeric", month: "short" });
  return { text: dateOnly ? date : `${date}, ${timeLabel(at.toISOString(), lang)}`, overdue };
}

/** How far ahead a scheduled run still counts as the agent's work for today. */
const UPCOMING_HORIZON_MS = 36 * 60 * 60 * 1000;

/** Enabled automations due inside the horizon, soonest first. */
export function upcomingRuns(
  automations: Automation[] | null,
): { automation: Automation; at: number }[] {
  const now = Date.now();
  return (automations ?? [])
    .filter((a) => a.enabled && a.nextRunAt)
    .map((a) => ({ automation: a, at: new Date(a.nextRunAt as string).getTime() }))
    .filter(({ at }) => at >= now && at < now + UPCOMING_HORIZON_MS)
    .sort((a, b) => a.at - b.at);
}
