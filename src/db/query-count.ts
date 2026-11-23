/**
 * Opt-in SQL statement counting.
 *
 * N+1 regressions are invisible in a wall-clock average on a small fixture, so
 * the perf probes and the integration budgets count statements instead. The
 * Drizzle logger is always attached, but it only records while a caller has
 * started a count, so production pays one boolean check per query.
 */

let active: string[] | null = null;

export function recordQuery(query: string): void {
  active?.push(query);
}

/** Begin recording. Nested starts replace the previous capture. */
export function startQueryCount(): void {
  active = [];
}

/** Stop recording and return the statements captured since `startQueryCount`. */
export function stopQueryCount(): string[] {
  const statements = active ?? [];
  active = null;
  return statements;
}

/** Statements captured so far in the active capture, or 0 when idle. */
export function countedQueries(): number {
  return active?.length ?? 0;
}
