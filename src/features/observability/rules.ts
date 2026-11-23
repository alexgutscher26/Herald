/**
 * Pure alert rule arithmetic.
 *
 * Keeping the decision here (rather than in the database query) means the
 * thresholds, the minimum-sample guard and the "empty window is healthy"
 * behaviour are covered by unit tests without a database.
 */

export const ALERT_RULES = [
  "http_5xx_rate",
  "job_failure_rate",
  "queue_depth",
  "email_bounce_rate",
  "webhook_failure_rate",
  "ai_daily_spend",
  "backup_freshness",
] as const;

export type AlertRuleId = (typeof ALERT_RULES)[number];
export type AlertState = "ok" | "firing";
export type AlertUnit = "percent" | "count" | "usd" | "hours";

export type AlertReading = {
  rule: AlertRuleId;
  title: string;
  state: AlertState;
  value: number;
  threshold: number;
  unit: AlertUnit;
  sampleSize: number;
  minSampleSize: number;
  detail: string;
};

export type AlertTransition = {
  previous: AlertState;
  next: AlertState;
  changed: boolean;
};

/**
 * A rate is only meaningful with enough observations. Below the minimum the
 * rule is healthy with an explicit "insufficient data" detail rather than
 * firing on one request.
 */
export function rateReading(input: {
  rule: AlertRuleId;
  title: string;
  numerator: number;
  denominator: number;
  thresholdPct: number;
  minSampleSize: number;
  detail: (value: number) => string;
}): AlertReading {
  const denominator = Math.max(0, input.denominator);
  const numerator = Math.min(Math.max(0, input.numerator), denominator);
  const value =
    denominator === 0 ? 0 : Math.round((numerator / denominator) * 10_000) / 100;

  if (denominator < input.minSampleSize) {
    return {
      rule: input.rule,
      title: input.title,
      state: "ok",
      value,
      threshold: input.thresholdPct,
      unit: "percent",
      sampleSize: denominator,
      minSampleSize: input.minSampleSize,
      detail:
        denominator === 0
          ? "No observations in the window."
          : `Only ${denominator} observation${denominator === 1 ? "" : "s"}; below the ${input.minSampleSize}-sample minimum.`,
    };
  }

  return {
    rule: input.rule,
    title: input.title,
    state: value > input.thresholdPct ? "firing" : "ok",
    value,
    threshold: input.thresholdPct,
    unit: "percent",
    sampleSize: denominator,
    minSampleSize: input.minSampleSize,
    detail: input.detail(value),
  };
}

/** A count/absolute threshold. `value > threshold` fires. */
export function thresholdReading(input: {
  rule: AlertRuleId;
  title: string;
  value: number;
  threshold: number;
  unit: AlertUnit;
  detail: (value: number) => string;
  /** Defaults to 1: an absolute metric is meaningful with one observation. */
  sampleSize?: number;
  minSampleSize?: number;
}): AlertReading {
  const value = Number.isFinite(input.value) ? input.value : 0;
  const sampleSize = input.sampleSize ?? 1;
  const minSampleSize = input.minSampleSize ?? 1;

  return {
    rule: input.rule,
    title: input.title,
    state: value > input.threshold ? "firing" : "ok",
    value,
    threshold: input.threshold,
    unit: input.unit,
    sampleSize,
    minSampleSize,
    detail: input.detail(value),
  };
}

export function transitionFor(previous: AlertState, next: AlertState): AlertTransition {
  return { previous, next, changed: previous !== next };
}
