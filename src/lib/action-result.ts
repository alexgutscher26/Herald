/**
 * Canonical server-action result.
 *
 * Every action returns this shape: `{ ok: true, data }` or
 * `{ ok: false, error, billingUrl?, fieldErrors? }`. Errors are values rather
 * than thrown exceptions so a client component can show a field-level message
 * without exposing a stack trace. `fieldErrors` keys match the form field
 * names.
 *
 * `@/features/live/action-result` re-exports these types and helpers for
 * existing imports.
 */

export type ActionFailure = {
  ok: false;
  error: string;
  /** Settings deep link for a plan-limit error, when one exists. */
  billingUrl?: string;
  fieldErrors?: Record<string, string[]>;
};

export type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true; data?: undefined } : { ok: true; data: T })
  | ActionFailure;

export function actionFailure(
  error: string,
  extra?: { billingUrl?: string; fieldErrors?: Record<string, string[]> },
): ActionFailure {
  return { ok: false, error, ...extra };
}

export function actionSuccess(): { ok: true; data?: undefined };
export function actionSuccess<T>(data: T): { ok: true; data: T };
export function actionSuccess<T>(data?: T): { ok: true; data?: T } {
  return data === undefined ? { ok: true } : { ok: true, data };
}

/** Convert a caught value into a safe action failure without leaking a stack. */
export function actionError(error: unknown, fallback: string): ActionFailure {
  if (error instanceof Error && error.message.length > 0) {
    return actionFailure(error.message);
  }
  return actionFailure(fallback);
}
