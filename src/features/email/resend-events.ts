import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { DeliveryEvent } from "./events";

/**
 * Resend webhook and inbound adapter.
 *
 * Resend signs both inbound and delivery webhooks with Svix headers. The
 * signature is over the exact raw request body, so callers must verify before
 * parsing. Inbound events carry metadata only; the body is fetched from the
 * Resend API with the deployment key.
 */

const DEFAULT_RESEND_API_URL = "https://api.resend.com/emails";
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;
const FETCH_TIMEOUT_MS = 10_000;

export type HeaderReader = {
  get(name: string): string | null;
};

export function verifyResendWebhookSignature(input: {
  headers: HeaderReader;
  payload: string;
  secret: string;
  now?: Date;
  toleranceSeconds?: number;
}): boolean {
  const id = input.headers.get("svix-id")?.trim() ?? "";
  const timestamp = input.headers.get("svix-timestamp")?.trim() ?? "";
  const signatures = input.headers.get("svix-signature")?.trim() ?? "";
  if (id === "" || timestamp === "" || signatures === "") return false;

  const seconds = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(seconds) || String(seconds) !== timestamp) return false;

  const tolerance = input.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
  const nowSeconds = Math.floor((input.now?.getTime() ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - seconds) > tolerance) return false;

  const secret = input.secret.trim();
  if (!secret.startsWith("whsec_")) return false;

  let key: Buffer;
  try {
    key = Buffer.from(secret.slice("whsec_".length), "base64");
  } catch {
    return false;
  }
  if (key.length === 0) return false;

  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${input.payload}`)
    .digest();

  for (const candidate of signatures.split(/\s+/)) {
    const [version, encoded] = candidate.split(",", 2);
    if (version !== "v1" || !encoded) continue;
    let provided: Buffer;
    try {
      provided = Buffer.from(encoded, "base64");
    } catch {
      continue;
    }
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) {
      return true;
    }
  }

  return false;
}

const inboundEventSchema = z
  .object({
    type: z.string(),
    data: z
      .object({
        email_id: z.string().min(1),
        to: z.array(z.string()).optional(),
        from: z.string().optional(),
        subject: z.string().nullable().optional(),
        message_id: z.string().nullable().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type ResendInboundEvent = {
  emailId: string;
  to: string[];
  from: string | null;
  subject: string | null;
  messageId: string | null;
};

export function parseResendInboundEvent(payload: unknown): ResendInboundEvent | null {
  const parsed = inboundEventSchema.safeParse(payload);
  if (!parsed.success || parsed.data.type !== "email.received") return null;
  return {
    emailId: parsed.data.data.email_id,
    to: parsed.data.data.to ?? [],
    from: parsed.data.data.from ?? null,
    subject: parsed.data.data.subject ?? null,
    messageId: parsed.data.data.message_id ?? null,
  };
}

const receivedEmailSchema = z
  .object({
    to: z.array(z.string()).optional(),
    from: z.string().nullable().optional(),
    subject: z.string().nullable().optional(),
    text: z.string().nullable().optional(),
    html: z.string().nullable().optional(),
    headers: z.record(z.string(), z.string()).nullable().optional(),
    message_id: z.string().nullable().optional(),
  })
  .passthrough();

export type NormalizedInboundEmail = {
  to: string;
  from: string;
  fromName?: string | undefined;
  subject?: string | undefined;
  text: string;
  messageId?: string | undefined;
  headers?: Record<string, string> | undefined;
};

function splitAddress(value: string): { name: string; email: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value);
  if (match?.[2]) {
    return { name: (match[1] ?? "").replace(/^"|"$/g, "").trim(), email: match[2].trim() };
  }
  return { name: "", email: value.trim() };
}

/** Best-effort plain-text fallback when the provider supplies only HTML. */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    .slice(0, 50_000);
}

export function normalizeResendInboundEmail(input: {
  event: ResendInboundEvent;
  email: unknown;
}): NormalizedInboundEmail | null {
  const parsed = receivedEmailSchema.safeParse(input.email);
  if (!parsed.success) return null;

  const recipients = (parsed.data.to ?? input.event.to)
    .map((value) => splitAddress(value).email)
    .filter((value) => value.includes("@"));
  const to = recipients[0];
  const headerFrom = Object.entries(parsed.data.headers ?? {}).find(
    ([key]) => key.toLowerCase() === "from",
  )?.[1];
  // Received events carry a bare address; the display name lives in the
  // original From header returned by the retrieve endpoint.
  const from = splitAddress(headerFrom ?? parsed.data.from ?? input.event.from ?? "");
  if (!to || from.email === "" || !from.email.includes("@")) return null;

  const text =
    parsed.data.text?.trim() ||
    htmlToText(parsed.data.html ?? "") ||
    "";

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed.data.headers ?? {})) {
    if (key.trim() !== "" && typeof value === "string") headers[key] = value;
  }

  return {
    to,
    from: from.email,
    ...(from.name === "" ? {} : { fromName: from.name }),
    ...(parsed.data.subject || input.event.subject
      ? { subject: parsed.data.subject ?? input.event.subject ?? undefined }
      : {}),
    text,
    // Fall back to Resend's stable email id so a webhook retry still dedupes
    // in the inbound thread even when the RFC Message-ID is absent.
    ...(parsed.data.message_id || input.event.messageId || input.event.emailId
      ? {
          messageId:
            parsed.data.message_id ??
            input.event.messageId ??
            input.event.emailId,
        }
      : {}),
    ...(Object.keys(headers).length === 0 ? {} : { headers }),
  };
}

const deliverySchema = z
  .object({
    type: z.string(),
    data: z
      .object({
        email_id: z.string().min(1),
        bounce: z
          .object({
            message: z.string().nullish(),
          })
          .passthrough()
          .nullish(),
      })
      .passthrough(),
  })
  .passthrough();

/**
 * Map Resend delivery events onto the internal shape. `email_id` is the id the
 * send API returned and is what `notification_deliveries` stores; an RFC
 * Message-ID would not match and would make every event look unknown.
 */
export function deliveryEventsFromResend(payload: unknown): DeliveryEvent[] {
  const batch = Array.isArray(payload) ? payload : [payload];
  const events: DeliveryEvent[] = [];

  for (const item of batch) {
    const parsed = deliverySchema.safeParse(item);
    if (!parsed.success) continue;
    const messageId = parsed.data.data.email_id;
    if (parsed.data.type === "email.delivered") {
      events.push({ type: "delivered", messageId, reason: null });
    } else if (parsed.data.type === "email.bounced") {
      events.push({
        type: "bounced",
        messageId,
        reason: parsed.data.data.bounce?.message ?? null,
      });
    } else if (parsed.data.type === "email.complained") {
      events.push({ type: "complained", messageId, reason: null });
    }
  }

  return events;
}

export function resendReceivedEmailUrl(emailId: string, apiUrl?: string): string {
  const url = new URL(apiUrl?.trim() || DEFAULT_RESEND_API_URL);
  const base = url.pathname.replace(/\/+$/, "");
  url.pathname = base.endsWith("/emails")
    ? `${base}/receiving/${encodeURIComponent(emailId)}`
    : `${base}/emails/receiving/${encodeURIComponent(emailId)}`;
  // Keep inline images as cid: references instead of downloading potentially
  // huge base64 payloads just to discard them during HTML-to-text.
  url.searchParams.set("html_format", "cid");
  return url.toString();
}

export type ReceivedEmailResult =
  | { ok: true; email: unknown }
  | { ok: false; error: string; retryable: boolean };

export async function fetchResendReceivedEmail(input: {
  emailId: string;
  apiKey: string;
  apiUrl?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
}): Promise<ReceivedEmailResult> {
  const doFetch = input.fetchImpl ?? fetch;
  try {
    const response = await doFetch(
      resendReceivedEmailUrl(input.emailId, input.apiUrl),
      {
        method: "GET",
        headers: { authorization: `Bearer ${input.apiKey}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      return {
        ok: false,
        error: `Email provider could not return the received message (HTTP ${response.status}).`,
        retryable: response.status === 429 || response.status >= 500,
      };
    }

    return { ok: true, email: await response.json() };
  } catch {
    return {
      ok: false,
      error: "Could not reach the email provider for the received message.",
      retryable: true,
    };
  }
}
