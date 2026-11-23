import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  applyDeliveryEvents,
  type DeliveryEvent,
  type DeliveryEventType,
} from "@/features/email/events";
import {
  deliveryEventsFromResend,
  verifyResendWebhookSignature,
} from "@/features/email/resend-events";
import { logEvent, serializeError } from "@/lib/logger";

/**
 * Provider delivery feedback.
 *
 * Accepts either a signed Resend event (the production path) or the normalized
 * bearer-authenticated batch used by compatible providers and tests. Both paths
 * end in the same idempotent delivery-event handler.
 */

export const dynamic = "force-dynamic";

const schema = z.object({
  events: z
    .array(
      z.object({
        type: z.enum(["delivered", "bounced", "complained"]),
        messageId: z.string().trim().min(1).max(300),
        reason: z.string().max(500).nullish(),
      }),
    )
    .min(1)
    .max(100),
});

function unauthorized(): NextResponse {
  return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
}

async function record(events: DeliveryEvent[]): Promise<NextResponse> {
  try {
    const summary = await applyDeliveryEvents(events);
    return NextResponse.json(summary, {
      status: 202,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    logEvent("error", "email.webhook_failed", { error: serializeError(error) });
    return NextResponse.json({ error: "Could not record the events." }, { status: 500 });
  }
}

async function handleResend(
  request: NextRequest,
  rawBody: string,
): Promise<NextResponse> {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim() ?? "";
  if (secret === "") {
    return NextResponse.json(
      { error: "The Resend delivery webhook is not configured." },
      { status: 503 },
    );
  }
  if (!verifyResendWebhookSignature({ headers: request.headers, payload: rawBody, secret })) {
    return unauthorized();
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid event payload." }, { status: 400 });
  }

  const events = deliveryEventsFromResend(json);
  if (events.length === 0) {
    return NextResponse.json(
      { applied: 0, ignored: 1, suppressed: 0 },
      { status: 202, headers: { "cache-control": "no-store" } },
    );
  }
  return record(events);
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
  if (signedByResend) return handleResend(request, rawBody);

  const secret = process.env.EMAIL_WEBHOOK_SECRET?.trim() ?? "";
  if (secret.length < 24) {
    return NextResponse.json(
      { error: "Email delivery events are not configured." },
      { status: 503 },
    );
  }

  const authorization = request.headers.get("authorization") ?? "";
  if (authorization !== `Bearer ${secret}`) return unauthorized();

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid event payload." }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid event payload." }, { status: 400 });
  }

  return record(
    parsed.data.events.map((event) => ({
      type: event.type as DeliveryEventType,
      messageId: event.messageId,
      reason: event.reason ?? null,
    })),
  );
}
