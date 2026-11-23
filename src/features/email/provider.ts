import "server-only";

import { getEmailConfig } from "@/lib/env";
import { currentRequestId } from "@/lib/observability/context";
import { withSpan } from "@/lib/observability/tracing";
import { isSandboxMode } from "@/lib/sandbox";

/**
 * Outbound email provider.
 *
 * One HTTP adapter (Resend) rather than a vendor SDK: the request is a single
 * JSON POST, so the dependency and its upgrade surface are avoided. Templates
 * and suppression live in this codebase; the provider only delivers bytes.
 *
 * When email is not configured, sends fail with a non-retryable error so a job
 * does not spin forever waiting for credentials.
 *
 * `EMAIL_API_URL` is an optional operator override for the endpoint (defaults
 * to Resend). It exists so a staging or integration environment can point the
 * adapter at a compatible server without swapping the implementation.
 */

export type EmailMessage = {
  to: string;
  /** A workspace sender identity; falls back to EMAIL_FROM when omitted. */
  from?: string | undefined;
  subject: string;
  html: string;
  text: string;
  /** Where a reply from the customer should land. */
  replyTo?: string | undefined;
  /** Base64-encoded file contents, e.g. a scheduled PDF or CSV export. */
  attachments?: Array<{ filename: string; content: string }> | undefined;
  /** Additional RFC 5322 headers, e.g. List-Unsubscribe. */
  headers?: Record<string, string> | undefined;
  idempotencyKey?: string | undefined;
};

export type SendEmailResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; error: string; retryable: boolean };

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const REQUEST_TIMEOUT_MS = 10_000;

export async function sendEmail(message: EmailMessage): Promise<SendEmailResult> {
  // Last line of defence: even a new call site cannot reach a provider while
  // the deployment is in sandbox mode.
  if (isSandboxMode()) {
    return {
      ok: false,
      error: "Sandbox mode: email is suppressed.",
      retryable: false,
    };
  }

  let config: ReturnType<typeof getEmailConfig>;
  try {
    config = getEmailConfig();
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Email configuration is invalid.",
      retryable: false,
    };
  }

  if (!config) {
    return {
      ok: false,
      error: "Email is not configured. Set RESEND_API_KEY and EMAIL_FROM.",
      retryable: false,
    };
  }

  const endpoint = config.EMAIL_API_URL ?? RESEND_ENDPOINT;
  const headers: Record<string, string> = {
    authorization: `Bearer ${config.RESEND_API_KEY}`,
    "content-type": "application/json",
  };
  if (message.idempotencyKey) {
    headers["idempotency-key"] = message.idempotencyKey;
  }
  // Distributed correlation: a job that sends a customer email keeps the id of
  // the request that enqueued it, and the provider log can be joined to ours.
  const requestId = currentRequestId();
  if (requestId) headers["x-request-id"] = requestId;

  try {
    const response = await withSpan("email.provider.send", { provider: "resend" }, () =>
      fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        from: message.from?.trim() || config.EMAIL_FROM,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.replyTo ? { reply_to: [message.replyTo] } : {}),
        ...(message.headers && Object.keys(message.headers).length > 0
          ? { headers: message.headers }
          : {}),
        ...(message.attachments && message.attachments.length > 0
          ? {
              attachments: message.attachments.map((attachment) => ({
                filename: attachment.filename,
                content: attachment.content,
              })),
            }
          : {}),
      }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }),
    );

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      return {
        ok: false,
        error: `Email provider rejected the message (HTTP ${response.status}).`,
        retryable,
      };
    }

    const data: unknown = await response.json().catch(() => null);
    const id =
      data && typeof data === "object" && "id" in data && typeof data.id === "string"
        ? data.id
        : "";

    return { ok: true, providerMessageId: id };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      ok: false,
      error: timedOut
        ? "Email provider timed out."
        : "Could not reach the email provider.",
      retryable: true,
    };
  }
}
