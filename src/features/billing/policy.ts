/** Pure billing timing and ordering rules (unit-tested without a database). */

export const DUNNING_GRACE_DAYS = 7;
export const DUNNING_REMINDER_DAYS = [0, 3, 6] as const;

export type DunningStage = 1 | 2 | 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** True when an event predates the newest one already applied. */
export function isOlderStripeEvent(
  eventCreated: number | undefined,
  lastEventAt: Date | null | undefined,
): boolean {
  if (typeof eventCreated !== "number" || !Number.isFinite(eventCreated)) {
    return false;
  }
  if (!lastEventAt) return false;
  return eventCreated * 1000 < lastEventAt.getTime();
}

/** The first failure owns the deadline; retries do not extend it. */
export function dunningGraceUntil(startedAt: Date): Date {
  return new Date(startedAt.getTime() + DUNNING_GRACE_DAYS * DAY_MS);
}

export function dunningReminderAt(startedAt: Date, stage: DunningStage): Date {
  const offset = DUNNING_REMINDER_DAYS[stage - 1] ?? 0;
  return new Date(startedAt.getTime() + offset * DAY_MS);
}

export function nextTrialEnd(
  currentTrialEnd: Date | null,
  now: Date,
  days: number,
): Date {
  const base =
    currentTrialEnd && currentTrialEnd.getTime() > now.getTime()
      ? currentTrialEnd
      : now;
  return new Date(base.getTime() + Math.max(1, Math.min(30, days)) * DAY_MS);
}