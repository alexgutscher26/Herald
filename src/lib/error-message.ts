/**
 * Turn an unknown thrown value into a message that is safe to show a user.
 * Never leaks stack traces, driver errors or configuration details.
 */
export function userFacingErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message.trim().slice(0, 300);
    }
  }
  return fallback;
}

/** Detect a PostgreSQL unique-constraint violation (`23505`) from any driver. */
export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  if (code === "23505") return true;

  // Some drivers nest the original error.
  const cause = (error as { cause?: unknown }).cause;
  if (cause && typeof cause === "object") {
    const nested = (cause as { code?: unknown }).code;
    if (nested === "23505") return true;
  }

  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.includes("duplicate key value");
}