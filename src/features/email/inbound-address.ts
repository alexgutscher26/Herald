import { randomBytes } from "node:crypto";

/**
 * Inbound email addressing and junk classification.
 *
 * Pure functions, no database and no request context: the webhook handler and
 * the unit tests share exactly the same parsing rules.
 *
 * Two plus-address shapes are accepted on one domain:
 *   support+<product token>@domain   → start a new conversation
 *   reply+<conversation token>@domain → continue an existing thread
 *
 * The token is opaque and unguessable; the domain comes from configuration so
 * a rotated inbound domain does not require rewriting stored rows.
 */

export type InboundRecipient =
  | { kind: "product"; token: string }
  | { kind: "conversation"; token: string };

export type JunkReason = "auto_reply" | "bounce" | "marketing";

const LOCAL_PART = /^(support|reply)\+([a-z0-9_-]{8,64})$/i;
const DISPLAY_ADDRESS = /<([^>]+)>/;

export function inboundDomain(): string {
  return (process.env.EMAIL_INBOUND_DOMAIN?.trim().toLowerCase() || "inbound.herald.local");
}

export function createInboundToken(): string {
  return randomBytes(18).toString("base64url");
}

export function productInboundAddress(token: string): string {
  return `support+${token}@${inboundDomain()}`;
}

export function conversationReplyAddress(token: string): string {
  return `reply+${token}@${inboundDomain()}`;
}

/**
 * Pull the bare address out of `"Name" <address>` or a raw address.
 *
 * The local part is NOT lowercased: tokens are base64url and therefore
 * case-sensitive. Callers that compare addresses normalize them separately.
 */
export function extractAddress(value: string): string {
  const match = DISPLAY_ADDRESS.exec(value);
  return (match?.[1] ?? value).trim();
}

export function parseInboundRecipient(
  value: string,
  domain: string = inboundDomain(),
): InboundRecipient | null {
  const address = extractAddress(value);
  const at = address.lastIndexOf("@");
  if (at <= 0) return null;
  if (address.slice(at + 1).toLowerCase() !== domain.trim().toLowerCase()) return null;

  const match = LOCAL_PART.exec(address.slice(0, at));
  if (!match) return null;

  const kind = match[1]!.toLowerCase() === "reply" ? "conversation" : "product";
  return { kind, token: match[2]! } as InboundRecipient;
}

/**
 * Decide whether a message is machine noise rather than a customer.
 *
 * Rules are deliberately conservative and header-first. A human writing
 * "Automatic reply needed?" is not classified as an auto-reply unless the
 * subject starts with the usual vacation prefixes.
 */
export function classifyInboundEmail(input: {
  from: string;
  subject?: string | null | undefined;
  headers?: Record<string, string | undefined> | null | undefined;
}): JunkReason | null {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.headers ?? {})) {
    if (typeof value === "string") headers[key.trim().toLowerCase()] = value.trim();
  }

  const from = extractAddress(input.from).toLowerCase();
  if (from.startsWith("mailer-daemon@") || from.startsWith("postmaster@")) {
    return "bounce";
  }
  if (
    headers["x-failed-recipients"] ||
    headers["content-type"]?.includes("multipart/report")
  ) {
    return "bounce";
  }

  const autoSubmitted = headers["auto-submitted"]?.toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return "auto_reply";
  if (headers["x-autoreply"] || headers["x-autorespond"] || headers["x-autoreply-from"]) {
    return "auto_reply";
  }

  const subject = (input.subject ?? "").trim();
  // Vacation subjects are often free-form ("Out of office until Monday"), so
  // those prefixes are enough. "Automatic reply" is only an auto-responder when
  // it carries the generated `:` separator; otherwise a human may be writing
  // "Automatic reply needed for the export".
  if (/^(out of office|vacation|abwesenheit)\b/i.test(subject)) {
    return "auto_reply";
  }
  if (/^(automatic reply|auto[- ]?reply)\s*:/i.test(subject)) {
    return "auto_reply";
  }

  if (headers["list-unsubscribe"] || headers["list-id"]) return "marketing";
  const precedence = headers["precedence"]?.toLowerCase();
  if (precedence === "bulk" || precedence === "list" || precedence === "junk") {
    return "marketing";
  }

  return null;
}
