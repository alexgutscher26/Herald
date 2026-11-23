import "server-only";

import { getEmailConfig } from "@/lib/env";
import { logEvent, serializeError } from "@/lib/logger";
import { isSandboxMode } from "@/lib/sandbox";

import { sendEmail } from "./provider";
import type { RenderedEmail } from "./templates";

/**
 * Account email (verification, password reset, password changed).
 *
 * These messages are sent directly rather than through the workspace outbox:
 * they belong to the account, not to a workspace, and they must not be
 * suppressed by a customer suppression list.
 *
 * Sending is best-effort. A provider outage or missing configuration is logged
 * and reported as `false`, so a sign-up or a reset request still succeeds —
 * both flows can be retried, and a user must never be locked out because the
 * mail provider is down. Verification is only *required* when this module
 * reports that email can actually be delivered (see `src/lib/auth.ts`).
 */

export function isAuthEmailConfigured(): boolean {
  if (isSandboxMode()) return false;

  try {
    return getEmailConfig() !== null;
  } catch (error) {
    // A half-configured provider is an operator error, not a reason to take
    // authentication down: log it and treat email as unavailable.
    logEvent("error", "auth.email_misconfigured", {
      error: serializeError(error),
    });
    return false;
  }
}

export async function sendAuthEmail(input: {
  to: string;
  /** A stable event name for logs; never includes the recipient or a token. */
  event:
    | "auth.email_verification"
    | "auth.email_change"
    | "auth.password_reset"
    | "auth.password_changed";
  email: RenderedEmail;
}): Promise<boolean> {
  if (isSandboxMode()) {
    logEvent("info", "auth.email_suppressed", { event: input.event });
    return false;
  }

  if (!isAuthEmailConfigured()) {
    logEvent("warn", "auth.email_unconfigured", { event: input.event });
    return false;
  }

  const result = await sendEmail({
    to: input.to,
    subject: input.email.subject,
    html: input.email.html,
    text: input.email.text,
  });

  if (!result.ok) {
    logEvent("error", "auth.email_failed", {
      event: input.event,
      retryable: result.retryable,
      error: result.error,
    });
    return false;
  }

  logEvent("info", "auth.email_sent", { event: input.event });
  return true;
}
