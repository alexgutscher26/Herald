import { NextResponse } from "next/server";

import { getBillingConfig } from "@/features/billing/config";
import { applyStripeEvent } from "@/features/billing/service";
import { verifyStripeSignature } from "@/features/billing/signature";
import { logEvent, serializeError } from "@/lib/logger";

/**
 * Stripe webhook.
 *
 * The raw body is verified before parsing. A duplicate event id is acknowledged
 * by the service without re-applying it; a processing failure returns 500 so
 * Stripe retries, and the transactional event marker rolls back with it.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  let config;
  try {
    config = getBillingConfig();
  } catch (error) {
    logEvent("error", "billing.webhook_config", { error: serializeError(error) });
    return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });
  }
  if (!config) {
    return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });
  }

  const payload = await request.text();
  if (payload.length === 0 || payload.length > 1_000_000) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const valid = verifyStripeSignature({
    header: request.headers.get("stripe-signature"),
    payload,
    secret: config.STRIPE_WEBHOOK_SECRET,
  });
  if (!valid) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  let event: { id?: unknown; type?: unknown; created?: unknown };
  try {
    event = JSON.parse(payload) as { id?: unknown; type?: unknown; created?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (typeof event.id !== "string" || typeof event.type !== "string") {
    return NextResponse.json({ error: "Invalid event." }, { status: 400 });
  }

  try {
    await applyStripeEvent(
      event as {
        id: string;
        type: string;
        created?: number;
        data?: { object?: unknown };
      },
    );
  } catch (error) {
    logEvent("error", "billing.webhook_failed", {
      eventId: event.id,
      type: event.type,
      error: serializeError(error),
    });
    return NextResponse.json({ error: "Retry later." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
