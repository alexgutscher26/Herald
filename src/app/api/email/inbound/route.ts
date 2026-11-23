import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  fetchResendReceivedEmail,
  normalizeResendInboundEmail,
  parseResendInboundEvent,
  verifyResendWebhookSignature,
} from "@/features/email/resend-events";
import { handleInboundEmail, type InboundEmailInput } from "@/features/email/inbound";
import { scheduleJunoAnswer } from "@/features/juno/schedule";

/**
 * Inbound email webhook.
 *
 * Accepts either the normalized bearer-authenticated JSON or a signed Resend
 * `email.received` event. Resend sends metadata only, so the adapter verifies
 * the Svix signature over the raw body and fetches the message body with the
 * deployment API key before handing it to the normal inbound pipeline.
 */

export const dynamic = "force-dynamic";

const payloadSchema = z.object({
  to: z.string().min(3).max(320),
  from: z.string().min(3).max(320),
  fromName: z.string().max(200).nullish(),
  subject: z.string().max(500).nullish(),
  text: z.string().min(1).max(50_000),
  messageId: z.string().max(512).nullish(),
  headers: z.record(z.string(), z.string()).nullish(),
});

function authorized(request: NextRequest): boolean {
  const secret = process.env.EMAIL_INBOUND_SECRET?.trim();
  if (!secret || secret.length < 24) return false;

  const header = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;

  const provided = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(secret);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

async function processInbound(input: InboundEmailInput): Promise<NextResponse> {
  try {
    const result = await handleInboundEmail(input);
    if (result.status === "accepted" && result.conversationId) {
      await scheduleJunoAnswer({
        conversationId: result.conversationId,
        messageId: result.messageId,
      });
    }
    // 202 for ignored junk too: the provider should not retry a message that
    // was deliberately dropped.
    return NextResponse.json(result, {
      status: result.status === "rejected" ? 422 : 202,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    console.error("[email] inbound failed", error);
    return NextResponse.json({ error: "Could not process the message." }, { status: 500 });
  }
}

async function handleResendInbound(
  request: NextRequest,
  rawBody: string,
): Promise<NextResponse> {
  const secret = process.env.RESEND_INBOUND_WEBHOOK_SECRET?.trim() ?? "";
  if (secret === "") {
    return NextResponse.json(
      { error: "The Resend inbound webhook is not configured." },
      { status: 503 },
    );
  }
  if (!verifyResendWebhookSignature({ headers: request.headers, payload: rawBody, secret })) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const event = parseResendInboundEvent(json);
  if (!event) {
    return NextResponse.json(
      { status: "ignored", reason: "unsupported_event" },
      { status: 202, headers: { "cache-control": "no-store" } },
    );
  }

  const apiKey = process.env.RESEND_API_KEY?.trim() ?? "";
  if (apiKey === "") {
    return NextResponse.json(
      { error: "The email provider API key is not configured." },
      { status: 503 },
    );
  }

  const received = await fetchResendReceivedEmail({
    emailId: event.emailId,
    apiKey,
    apiUrl: process.env.EMAIL_API_URL?.trim() || undefined,
  });
  if (!received.ok) {
    console.error("[email] inbound provider fetch failed", received.error);
    return NextResponse.json(
      { error: received.error },
      { status: received.retryable ? 503 : 422 },
    );
  }

  const normalized = normalizeResendInboundEmail({ event, email: received.email });
  if (!normalized) {
    return NextResponse.json(
      { status: "ignored", reason: "invalid_payload" },
      { status: 202, headers: { "cache-control": "no-store" } },
    );
  }
  if (normalized.text.trim() === "") {
    return NextResponse.json(
      { status: "ignored", reason: "empty_body" },
      { status: 202, headers: { "cache-control": "no-store" } },
    );
  }

  return processInbound(normalized);
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (rawBody.length > 1_000_000) {
    return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  }
  const signedByResend =
    request.headers.has("svix-id") ||
    request.headers.has("svix-timestamp") ||
    request.headers.has("svix-signature");

  if (signedByResend) return handleResendInbound(request, rawBody);
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  return processInbound(parsed.data);
}
