/**
 * Pure budget thresholds, shared by the writer and the activity meter.
 *
 * The alert fires at 80% of the daily limit, rounded up so a one-cent budget
 * still has an alert point. A zero budget disables paid generation and has no
 * alert threshold.
 */
export function budgetAlertThreshold(limitCents: number): number | null {
  const limit = Number.isFinite(limitCents)
    ? Math.max(0, Math.trunc(limitCents))
    : 0;
  return limit > 0 ? Math.ceil(limit * 0.8) : null;
}
