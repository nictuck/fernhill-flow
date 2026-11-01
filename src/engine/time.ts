// Pure date helpers for the engine and the UI. Inputs are ISO strings and
// all arithmetic is UTC, so a snapshot derives the same way on every clock.

const DAY_MS = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Whole days from `fromIso` to `nowIso`, floored, never negative; 0 on unparsable input. */
export function daysBetween(fromIso: string, nowIso: string): number {
  const from = Date.parse(fromIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(from) || Number.isNaN(now)) return 0;
  const days = Math.floor((now - from) / DAY_MS);
  return days > 0 ? days : 0;
}

/**
 * "12 Oct", or "12 Oct 2025" when the date is not in the same year as `now`.
 * `now` defaults to the real clock; pass it explicitly for deterministic output.
 */
export function fmtDate(iso: string, now?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.getUTCDate();
  const month = MONTHS[d.getUTCMonth()] ?? "";
  const year = d.getUTCFullYear();
  const ref = now === undefined ? new Date() : new Date(now);
  const refYear = Number.isNaN(ref.getTime()) ? year : ref.getUTCFullYear();
  return year === refYear ? `${day} ${month}` : `${day} ${month} ${year}`;
}

/** "1 day" / "6 days". */
export function fmtDays(n: number): string {
  return plural(n, "day");
}

/** "1 incident" / "2 incidents"; pass `many` for irregular plurals. */
export function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Snapshot age in whole minutes (floored, never negative; 0 on unparsable input). */
export function ageMinutes(collectedAt: string, now: string): number {
  const from = Date.parse(collectedAt);
  const to = Date.parse(now);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  const minutes = Math.floor((to - from) / 60_000);
  return minutes > 0 ? minutes : 0;
}

/** R8: a snapshot older than the refresh interval triggers a background refresh. */
export function needsRefresh(collectedAt: string, now: string, intervalMinutes: number): boolean {
  return ageMinutes(collectedAt, now) > intervalMinutes;
}

/** R8: a snapshot older than three intervals shows the stale state. */
export function isStale(collectedAt: string, now: string, intervalMinutes: number): boolean {
  return ageMinutes(collectedAt, now) > 3 * intervalMinutes;
}
