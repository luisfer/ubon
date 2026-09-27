/** Durations and age wording shared by the deps rules and the online lookups. */

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Age for messages, rounded down: "40 minutes", "5 hours", "3 days". */
export function describeAge(iso: string, now: number): string {
  const ms = Math.max(0, now - Date.parse(iso));
  if (ms < HOUR) {
    const minutes = Math.max(1, Math.floor(ms / MINUTE));
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  if (ms < 2 * DAY) {
    const hours = Math.floor(ms / HOUR);
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `${Math.floor(ms / DAY)} days`;
}
