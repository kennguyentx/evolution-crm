// lib/digest-schedule.ts
// Pins the daily intake digest to 07:00 America/Chicago year-round.
//
// Vercel cron schedules are UTC-only, so vercel.json fires the digest route
// twice every morning — 12:00 UTC and 13:00 UTC. Exactly one of those is
// 07:00 in Chicago (12:00 UTC during CDT, 13:00 UTC during CST); the digest
// route's scheduled path checks the Chicago hour here and skips the other
// firing. Extracted as a pure helper so the DST behavior is unit-testable
// (see lib/digest-schedule.test.ts).

export const DIGEST_TIME_ZONE = 'America/Chicago'
export const DIGEST_HOUR = 7

/** Hour of day (0–23) in America/Chicago for the given instant. */
export function chicagoHour(date: Date): number {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: DIGEST_TIME_ZONE,
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date).find(p => p.type === 'hour')?.value
  const n = hour ? Number.parseInt(hour, 10) : NaN
  // hourCycle 'h23' can report midnight as 24 in some runtimes.
  return Number.isNaN(n) ? NaN : n % 24
}

/** True when `date` falls inside the 07:00 hour in America/Chicago. */
export function isDigestHourInChicago(date: Date): boolean {
  return chicagoHour(date) === DIGEST_HOUR
}
