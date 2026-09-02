/**
 * Shared date/time formatters. Everything here just wraps `Intl` with the
 * project's chosen shapes. Chat cards, the library grid, and the Home
 * feed all render the same timestamp the same way. Times are always 24h
 * ("14:32"), whatever the language's locale default would be.
 */

/** 24h clock in every language, "h23" so midnight renders 00:32, never 24:32. */
const HOUR_CYCLE: Intl.DateTimeFormatOptions = { hourCycle: "h23" };

const DATE_TIME: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  ...HOUR_CYCLE,
};
const TIME: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", ...HOUR_CYCLE };
const DAY_LONG: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" };
const DAY_LONG_SHORT_MONTH: Intl.DateTimeFormatOptions = {
  weekday: "long",
  day: "numeric",
  month: "short",
};
const WEEKDAY: Intl.DateTimeFormatOptions = { weekday: "short" };
const DATE_SHORT: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" };

/** Built once per (shape, language): an Intl formatter costs far more to build than to use. */
const formatters = new WeakMap<Intl.DateTimeFormatOptions, Map<string, Intl.DateTimeFormat>>();

function format(iso: string | Date, lang: string, options: Intl.DateTimeFormatOptions): string {
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  let byLang = formatters.get(options);
  if (!byLang) {
    byLang = new Map();
    formatters.set(options, byLang);
  }
  let formatter = byLang.get(lang);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(lang, options);
    byLang.set(lang, formatter);
  }
  return formatter.format(date);
}

/** Whether the timestamp falls on the current local date. */
export function isToday(iso: string): boolean {
  return new Date(iso).toDateString() === new Date().toDateString();
}

const rtfCache = new Map<string, Intl.RelativeTimeFormat>();

/** "3 days ago", "yesterday", "6 weeks ago", in the given language. */
export function relativeTime(iso: string, lang: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  let rtf = rtfCache.get(lang);
  if (!rtf) {
    rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
    rtfCache.set(lang, rtf);
  }
  const diff = then - Date.now();
  const abs = Math.abs(diff);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < hour) return rtf.format(Math.round(diff / minute), "minute");
  if (abs < day) return rtf.format(Math.round(diff / hour), "hour");
  if (abs < 7 * day) return rtf.format(Math.round(diff / day), "day");
  // Weeks run to two months so a six-week wait never rounds to "last month".
  if (abs < 60 * day) return rtf.format(Math.round(diff / (7 * day)), "week");
  if (abs < 365 * day) return rtf.format(Math.round(diff / (30 * day)), "month");
  return rtf.format(Math.round(diff / (365 * day)), "year");
}

/** "9 Jul, 14:32"-style absolute label used by chat history and draft review.
 *  Empty or unparsable input returns "". */
export function dateTimeLabel(iso: string, lang: string): string {
  return format(iso, lang, DATE_TIME);
}

/**
 * `dateTimeLabel` for a fresh timestamp, its age ("3 weeks ago") once it is
 * older than three days. For a list of things waiting on the user, how long
 * one has waited says more than the clock time it was filed at.
 */
export function waitingLabel(iso: string, lang: string): string {
  const age = Date.now() - new Date(iso).getTime();
  return age > 3 * 86_400_000 ? relativeTime(iso, lang) : dateTimeLabel(iso, lang);
}

/** "Wednesday, 9 July"-style day heading, groups the Home activity feed. */
export function dayLabel(iso: string, lang: string): string {
  return format(iso, lang, DAY_LONG);
}

/** "14:32"-style time-only label, paired with `dayLabel` in the Home activity feed. */
export function timeLabel(iso: string, lang: string): string {
  return format(iso, lang, TIME);
}

/** "Mon"-style weekday, for a gutter too narrow for a date. */
export function weekdayLabel(iso: string, lang: string): string {
  return format(iso, lang, WEEKDAY);
}

/** "Mon, 9 Jul"-style short date, for a due date or a day label. */
export function shortDateLabel(iso: string, lang: string): string {
  return format(iso, lang, DATE_SHORT);
}

/**
 * A compact "when": bare time for a timestamp that falls today, else the day
 * plus the time: "14:32" or "Fri · 14:32" (`style: "short"`, the default),
 * / "Wednesday, 9 Jul · 14:32" (`style: "long"`). Every spot that needs a
 * short absolute time collapsing to time-only on the current day shares this
 * one comparison against the current date, so they can't drift out of sync
 * with each other.
 */
export function dayTimeLabel(iso: string, lang: string, style: "short" | "long" = "short"): string {
  const time = timeLabel(iso, lang);
  if (isToday(iso)) return time;
  const day = format(iso, lang, style === "long" ? DAY_LONG_SHORT_MONTH : WEEKDAY);
  return `${day} · ${time}`;
}

/**
 * A row's "when": the clock alone for a timestamp from today, the date with its
 * clock otherwise, so a row that has waited past midnight never reads as today.
 */
export function whenLabel(iso: string, lang: string): string {
  return isToday(iso) ? timeLabel(iso, lang) : dateTimeLabel(iso, lang);
}
