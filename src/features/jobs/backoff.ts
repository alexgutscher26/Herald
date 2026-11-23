/**
 * Retry delay after a failed attempt.
 *
 * 30s, 60s, 2m, 4m … capped at one hour. Deliberately deterministic so tests
 * can assert the schedule; add jitter only if contention becomes a problem.
 */
export function nextAttemptAt(attempts: number, now: Date = new Date()): Date {
  const exponent = Math.max(0, Math.trunc(attempts) - 1);
  const delayMs = Math.min(60 * 60 * 1000, 30_000 * 2 ** exponent);
  return new Date(now.getTime() + delayMs);
}
