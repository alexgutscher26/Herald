/**
 * Net Promoter Score.
 *
 * The split is the standard one: 9–10 promoters, 7–8 passives, 0–6 detractors,
 * and NPS is promoter percentage minus detractor percentage. Passives count in
 * the denominator but not the numerator, which is why the three percentages add
 * up to 100 while the score does not.
 *
 * The trend groups answers by UTC week starting Monday. Weeks with no answers
 * are kept as `null` rather than dropped, so a gap in the chart means a gap in
 * the data instead of a silently compressed timeline.
 */

export type NpsBucket = "promoter" | "passive" | "detractor";

export function npsBucket(score: number): NpsBucket | null {
  if (!Number.isFinite(score)) return null;
  if (score >= 9) return "promoter";
  if (score >= 7) return "passive";
  if (score >= 0) return "detractor";
  return null;
}

export type NpsSummary = {
  total: number;
  promoters: number;
  passives: number;
  detractors: number;
  promoterPct: number;
  passivePct: number;
  detractorPct: number;
  /** Promoter percentage minus detractor percentage, rounded, −100…100. */
  score: number;
};

function pct(part: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

export function summarizeNps(ratings: readonly number[]): NpsSummary | null {
  const valid = ratings.filter(
    (value) => Number.isFinite(value) && value >= 0 && value <= 10,
  );
  if (valid.length === 0) return null;

  const promoters = valid.filter((value) => value >= 9).length;
  const passives = valid.filter((value) => value >= 7 && value <= 8).length;
  const detractors = valid.filter((value) => value <= 6).length;

  return {
    total: valid.length,
    promoters,
    passives,
    detractors,
    promoterPct: pct(promoters, valid.length),
    passivePct: pct(passives, valid.length),
    detractorPct: pct(detractors, valid.length),
    score: Math.round(((promoters - detractors) / valid.length) * 100),
  };
}

export type NpsTrendPoint = {
  /** ISO date of the Monday that starts the bucket (UTC). */
  start: string;
  /** Short label such as "17 Nov". */
  label: string;
  responses: number;
  score: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function mondayUtc(date: Date): Date {
  const copy = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const weekday = copy.getUTCDay(); // 0 = Sunday
  const offset = weekday === 0 ? 6 : weekday - 1;
  copy.setUTCDate(copy.getUTCDate() - offset);
  return copy;
}

function labelUtc(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * Weekly NPS for the last `weeks` weeks, oldest first.
 *
 * `now` is injectable so the trend is testable without freezing the clock. A
 * response older than the window is ignored; a response in the future is
 * ignored too rather than inventing a bucket.
 */
export function npsTrend(
  points: ReadonlyArray<{ createdAt: Date; score: number | null }>,
  weeks = 8,
  now: Date = new Date(),
): NpsTrendPoint[] {
  const count = Math.max(1, Math.min(52, Math.trunc(weeks)));
  const currentMonday = mondayUtc(now);
  const buckets: NpsTrendPoint[] = [];
  const scores = new Map<string, number[]>();

  for (let index = count - 1; index >= 0; index -= 1) {
    const start = new Date(currentMonday.getTime() - index * 7 * DAY_MS);
    const key = start.toISOString().slice(0, 10);
    buckets.push({ start: key, label: labelUtc(start), responses: 0, score: null });
    scores.set(key, []);
  }

  for (const point of points) {
    if (point.score === null || !Number.isFinite(point.score)) continue;
    if (point.score < 0 || point.score > 10) continue;
    const createdAt = point.createdAt.getTime();
    if (!Number.isFinite(createdAt) || createdAt > now.getTime()) continue;
    const key = mondayUtc(point.createdAt).toISOString().slice(0, 10);
    const bucket = scores.get(key);
    if (!bucket) continue;
    bucket.push(point.score);
  }

  for (const point of buckets) {
    const values = scores.get(point.start) ?? [];
    point.responses = values.length;
    const summary = summarizeNps(values);
    point.score = summary ? summary.score : null;
  }

  return buckets;
}
