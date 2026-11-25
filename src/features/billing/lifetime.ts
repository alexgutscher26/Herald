import "server-only";

import { and, asc, count, eq, inArray, lt, or } from "drizzle-orm";

import { db } from "@/db";
import {
  lifetimeDeals,
  lifetimeSeats,
  stripeEvents,
  workspaceMembers,
  workspaceSubscriptions,
  workspaces,
  LIFETIME_AMOUNT_CENTS,
  LIFETIME_RESERVATION_MINUTES,
  LIFETIME_SEAT_LIMIT,
  type LifetimeDeal,
} from "@/db/schema";
import { sendEmail } from "@/features/email/provider";
import { logEvent, serializeError } from "@/lib/logger";

import { getBillingConfig } from "./config";
import {
  createStripeCustomer,
  createStripeLifetimeCheckoutSession,
  refundStripePaymentIntent,
} from "./stripe";

/**
 * Founding Lifetime.
 *
 * Checkout reserves one of the 100 pre-seeded seats first, so Stripe is never
 * asked to take money for a seat that does not exist. The webhook is the only
 * writer of the plan: a completed payment marks the deal active and moves the
 * workspace to `lifetime`; a full refund releases the seat and restores Free.
 */

export type LifetimeAvailability = {
  remaining: number;
  sold: number;
  limit: number;
  soldOut: boolean;
};

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function releaseExpired(tx: Transaction, now: Date): Promise<void> {
  await tx
    .update(lifetimeSeats)
    .set({ status: "available", reservedUntil: null, workspaceId: null, updatedAt: now })
    .where(
      and(
        eq(lifetimeSeats.status, "reserved"),
        lt(lifetimeSeats.reservedUntil, now),
      ),
    );

  await tx
    .delete(lifetimeDeals)
    .where(
      and(eq(lifetimeDeals.status, "reserved"), lt(lifetimeDeals.reservedUntil, now)),
    );
}

export async function getLifetimeAvailability(): Promise<LifetimeAvailability> {
  const now = new Date();
  await db.transaction(async (tx) => releaseExpired(tx, now));

  const rows = await db
    .select({ value: count() })
    .from(lifetimeSeats)
    .where(inArray(lifetimeSeats.status, ["reserved", "active"]));

  const sold = Number(rows[0]?.value ?? 0);
  const remaining = Math.max(0, LIFETIME_SEAT_LIMIT - sold);
  return {
    remaining,
    sold,
    limit: LIFETIME_SEAT_LIMIT,
    soldOut: remaining === 0,
  };
}

/** A free owner's workspace is the one the pricing CTA can check out for. */
export async function findLifetimeEligibleWorkspace(
  userId: string,
): Promise<{ id: string; slug: string } | null> {
  const rows = await db
    .select({ id: workspaces.id, slug: workspaces.slug })
    .from(workspaces)
    .innerJoin(
      workspaceMembers,
      eq(workspaceMembers.workspaceId, workspaces.id),
    )
    .where(
      and(
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.role, "owner"),
        eq(workspaces.plan, "free"),
      ),
    )
    .orderBy(asc(workspaces.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

type ReservationResult =
  | { ok: true; deal: LifetimeDeal; expiresAt: Date }
  | { ok: false; error: string };

async function reserveSeat(input: {
  workspaceId: string;
  purchaserUserId: string;
}): Promise<ReservationResult> {
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + LIFETIME_RESERVATION_MINUTES * 60 * 1000,
  );

  try {
    return await db.transaction(async (tx) => {
      await releaseExpired(tx, now);

      const workspaceRows = await tx
        .select({ plan: workspaces.plan })
        .from(workspaces)
        .where(eq(workspaces.id, input.workspaceId))
        .limit(1);
      if (workspaceRows[0]?.plan !== "free") {
        return {
          ok: false as const,
          error: "The Founding Lifetime deal is only available to a Free workspace.",
        };
      }

      const subscription = await tx
        .select({ status: workspaceSubscriptions.status })
        .from(workspaceSubscriptions)
        .where(eq(workspaceSubscriptions.workspaceId, input.workspaceId))
        .limit(1);
      const status = subscription[0]?.status;
      if (status === "active" || status === "trialing" || status === "lifetime") {
        return {
          ok: false as const,
          error: "This workspace already has a paid plan.",
        };
      }

      const existing = await tx
        .select({ status: lifetimeDeals.status })
        .from(lifetimeDeals)
        .where(eq(lifetimeDeals.workspaceId, input.workspaceId))
        .limit(1);
      if (existing[0]) {
        return {
          ok: false as const,
          error:
            existing[0].status === "refunded" || existing[0].status === "revoked"
              ? "This workspace has already used its one Founding Lifetime purchase."
              : "This workspace already has a lifetime purchase.",
        };
      }

      const purchaser = await tx
        .select({ workspaceId: lifetimeDeals.workspaceId })
        .from(lifetimeDeals)
        .where(
          and(
            eq(lifetimeDeals.purchaserUserId, input.purchaserUserId),
            inArray(lifetimeDeals.status, ["reserved", "active"]),
          ),
        )
        .limit(1);
      if (purchaser[0]) {
        return {
          ok: false as const,
          error: "This account already has a lifetime workspace. One purchase per account.",
        };
      }

      const seatRows = await tx
        .select()
        .from(lifetimeSeats)
        .where(eq(lifetimeSeats.status, "available"))
        .orderBy(asc(lifetimeSeats.seatNumber))
        .limit(1)
        .for("update", { skipLocked: true });
      const seat = seatRows[0];
      if (!seat) {
        return {
          ok: false as const,
          error: "The Founding Lifetime offer is sold out.",
        };
      }

      await tx
        .update(lifetimeSeats)
        .set({
          status: "reserved",
          reservedUntil: expiresAt,
          workspaceId: input.workspaceId,
          updatedAt: now,
        })
        .where(eq(lifetimeSeats.seatNumber, seat.seatNumber));

      const inserted = await tx
        .insert(lifetimeDeals)
        .values({
          workspaceId: input.workspaceId,
          purchaserUserId: input.purchaserUserId,
          seatNumber: seat.seatNumber,
          amountCents: LIFETIME_AMOUNT_CENTS,
          status: "reserved",
          reservedUntil: expiresAt,
        })
        .returning();

      const deal = inserted[0];
      if (!deal) throw new Error("The lifetime reservation could not be stored.");
      return { ok: true as const, deal, expiresAt };
    });
  } catch (error) {
    logEvent("error", "billing.lifetime_reserve_failed", {
      workspaceId: input.workspaceId,
      error: serializeError(error),
    });
    return { ok: false, error: "The founding seat could not be reserved. Try again." };
  }
}

async function releaseReservation(workspaceId: string): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(lifetimeSeats)
      .set({ status: "available", reservedUntil: null, workspaceId: null, updatedAt: now })
      .where(
        and(
          eq(lifetimeSeats.workspaceId, workspaceId),
          eq(lifetimeSeats.status, "reserved"),
        ),
      );
    await tx
      .delete(lifetimeDeals)
      .where(
        and(
          eq(lifetimeDeals.workspaceId, workspaceId),
          eq(lifetimeDeals.status, "reserved"),
        ),
      );
  });
}

export async function startLifetimeCheckout(input: {
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  purchaserUserId: string;
  email: string;
}): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  let config;
  try {
    config = getBillingConfig();
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Billing configuration is invalid.",
    };
  }
  if (!config) {
    return { ok: false, error: "Stripe billing is not configured on this deployment." };
  }
  if (config.STRIPE_PRICE_LIFETIME === "") {
    return { ok: false, error: "The Founding Lifetime offer is not configured." };
  }

  const reservation = await reserveSeat({
    workspaceId: input.workspaceId,
    purchaserUserId: input.purchaserUserId,
  });
  if (!reservation.ok) return reservation;

  try {
    const customerRows = await db
      .select({ customerId: workspaceSubscriptions.stripeCustomerId })
      .from(workspaceSubscriptions)
      .where(eq(workspaceSubscriptions.workspaceId, input.workspaceId))
      .limit(1);

    let customerId = customerRows[0]?.customerId ?? null;
    if (!customerId) {
      const created = await createStripeCustomer({
        email: input.email,
        name: input.workspaceName,
        workspaceId: input.workspaceId,
      });
      if (!created.ok) throw new Error(created.error);
      customerId = created.customer.id;
      await db
        .insert(workspaceSubscriptions)
        .values({
          workspaceId: input.workspaceId,
          plan: "free",
          status: "free",
          stripeCustomerId: customerId,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: workspaceSubscriptions.workspaceId,
          set: { stripeCustomerId: customerId, updatedAt: new Date() },
        });
    }

    const settingsUrl = `${config.APP_URL}/app/${encodeURIComponent(
      input.workspaceSlug,
    )}/settings`;
    const session = await createStripeLifetimeCheckoutSession({
      customerId,
      priceId: config.STRIPE_PRICE_LIFETIME,
      workspaceId: input.workspaceId,
      purchaserUserId: input.purchaserUserId,
      expiresAt: reservation.expiresAt,
      successUrl: `${settingsUrl}?billing=lifetime-success`,
      cancelUrl: `${settingsUrl}?billing=lifetime-cancelled`,
      termsUrl: `${config.APP_URL}/legal/lifetime`,
    });
    if (!session.ok) throw new Error(session.error);
    if (!session.session.url) throw new Error("Stripe did not return a checkout URL.");

    await db
      .update(lifetimeDeals)
      .set({ stripeCheckoutSessionId: session.session.id, updatedAt: new Date() })
      .where(eq(lifetimeDeals.workspaceId, input.workspaceId));

    return { ok: true, url: session.session.url };
  } catch (error) {
    await releaseReservation(input.workspaceId);
    logEvent("error", "billing.lifetime_checkout_failed", {
      workspaceId: input.workspaceId,
      error: serializeError(error),
    });
    return {
      ok: false,
      error: "Stripe could not start the lifetime checkout. No charge was made.",
    };
  }
}

type StripeEvent = { id: string; type: string; data?: { object?: unknown } };

type LifetimeCheckoutObject = {
  id?: unknown;
  mode?: unknown;
  payment_status?: unknown;
  customer?: unknown;
  customer_details?: unknown;
  payment_intent?: unknown;
  amount_total?: unknown;
  metadata?: unknown;
  client_reference_id?: unknown;
};

function checkoutEmail(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  return stringValue((value as Record<string, unknown>).email);
}

/**
 * Stripe issues the invoice, but the seat number and the caps are ours. Send
 * them once, after the grant commits; a mail failure must not roll back a paid
 * entitlement or make Stripe retry the event forever.
 */
async function sendLifetimeEmail(input: {
  to: string | null;
  seatNumber: number;
  kind: "granted" | "unavailable";
}): Promise<void> {
  if (!input.to) return;
  try {
    const config = getBillingConfig();
    const origin = config?.APP_URL ?? "";
    const subject =
      input.kind === "granted"
        ? `Founding Lifetime confirmed — seat ${input.seatNumber} of 100`
        : "Your Founding Lifetime payment has been refunded";
    const body =
      input.kind === "granted"
        ? `Your Founding Lifetime purchase is confirmed. Seat ${input.seatNumber} of 100. You paid $499 once; there is no renewal.

Included: unlimited products, boards and integrations, 15 team members, 5,000 emails a month and 150 Mira replies a month. SSO, SCIM and identity masking are not included.

You can request a full refund within 30 days. Terms: ${origin}/legal/lifetime`
        : `A payment reached us after the founding seat could no longer be held, so we did not grant a 101st seat. The payment is being refunded in full.

If you still want the offer, reply to this email and we will help. Terms: ${origin}/legal/lifetime`;

    const result = await sendEmail({
      to: input.to,
      subject,
      text: body,
      html: `<p>${body.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br />")}</p>`,
    });
    if (!result.ok) {
      logEvent("warn", "billing.lifetime_email_failed", {
        seatNumber: input.seatNumber,
        kind: input.kind,
        error: result.error,
      });
    }
  } catch (error) {
    logEvent("warn", "billing.lifetime_email_failed", {
      seatNumber: input.seatNumber,
      kind: input.kind,
      error: serializeError(error),
    });
  }
}

type RefundChargeObject = {
  payment_intent?: unknown;
  amount?: unknown;
  amount_refunded?: unknown;
  refunded?: unknown;
};

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function metadataValue(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  return stringValue((value as Record<string, unknown>)[key]);
}

export function isLifetimeStripeEvent(event: StripeEvent): boolean {
  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.expired"
  ) {
    const session = event.data?.object as LifetimeCheckoutObject | undefined;
    return (
      session?.mode === "payment" &&
      metadataValue(session.metadata, "offer") === "lifetime"
    );
  }
  return event.type === "charge.refunded";
}

/**
 * Apply a lifetime-related event exactly once.
 *
 * Returns true when the event belongs to the lifetime flow (including a
 * `charge.refunded` for an unrelated charge, which is claimed and ignored) so
 * the caller does not pass it to the subscription branch.
 */
export async function applyLifetimeStripeEvent(event: StripeEvent): Promise<boolean> {
  if (!isLifetimeStripeEvent(event)) return false;

  if (event.type === "checkout.session.expired") {
    const session = event.data?.object as LifetimeCheckoutObject | undefined;
    const sessionId = stringValue(session?.id);
    await db.transaction(async (tx) => {
      const claimed = await tx
        .insert(stripeEvents)
        .values({ id: event.id, type: event.type })
        .onConflictDoNothing()
        .returning({ id: stripeEvents.id });
      if (!claimed[0]) return;

      if (!sessionId) return;
      const deals = await tx
        .select()
        .from(lifetimeDeals)
        .where(eq(lifetimeDeals.stripeCheckoutSessionId, sessionId))
        .limit(1);
      const deal = deals[0];
      if (!deal || deal.status !== "reserved") return;

      await tx
        .update(lifetimeSeats)
        .set({
          status: "available",
          reservedUntil: null,
          workspaceId: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(lifetimeSeats.workspaceId, deal.workspaceId),
            eq(lifetimeSeats.status, "reserved"),
          ),
        );
      await tx.delete(lifetimeDeals).where(eq(lifetimeDeals.workspaceId, deal.workspaceId));
    });
    return true;
  }

  if (event.type === "charge.refunded") {
    const charge = event.data?.object as RefundChargeObject | undefined;
    const paymentIntent = stringValue(charge?.payment_intent);
    const amount = numberValue(charge?.amount) ?? 0;
    const refunded = numberValue(charge?.amount_refunded) ?? 0;
    const fullRefund = charge?.refunded === true || (amount > 0 && refunded >= amount);
    if (!paymentIntent || !fullRefund) {
      // A partial refund does not revoke the plan, but the event is still
      // claimed so Stripe is not asked to deliver it again.
      await db
        .insert(stripeEvents)
        .values({ id: event.id, type: event.type })
        .onConflictDoNothing();
      return true;
    }

    await db.transaction(async (tx) => {
      const claimed = await tx
        .insert(stripeEvents)
        .values({ id: event.id, type: event.type })
        .onConflictDoNothing()
        .returning({ id: stripeEvents.id });
      if (!claimed[0]) return;

      const deals = await tx
        .select()
        .from(lifetimeDeals)
        .where(eq(lifetimeDeals.stripePaymentIntentId, paymentIntent))
        .limit(1);
      const deal = deals[0];
      if (!deal || deal.status !== "active") return;

      const now = new Date();
      await tx
        .update(lifetimeDeals)
        .set({ status: "refunded", refundedAt: now, updatedAt: now })
        .where(eq(lifetimeDeals.workspaceId, deal.workspaceId));
      await tx
        .update(lifetimeSeats)
        .set({ status: "available", workspaceId: null, reservedUntil: null, updatedAt: now })
        .where(eq(lifetimeSeats.seatNumber, deal.seatNumber));
      await tx
        .update(workspaces)
        .set({ plan: "free", updatedAt: now })
        .where(eq(workspaces.id, deal.workspaceId));
      await tx
        .update(workspaceSubscriptions)
        .set({
          plan: "free",
          status: "free",
          stripeSubscriptionId: null,
          stripePriceId: null,
          updatedAt: now,
        })
        .where(eq(workspaceSubscriptions.workspaceId, deal.workspaceId));
    });
    return true;
  }

  const session = event.data?.object as LifetimeCheckoutObject | undefined;
  const sessionId = stringValue(session?.id);
  const workspaceId =
    metadataValue(session?.metadata, "workspace_id") ??
    stringValue(session?.client_reference_id);
  const paymentIntent = stringValue(session?.payment_intent);
  const customerId = stringValue(session?.customer);
  const amount = numberValue(session?.amount_total);
  const email = checkoutEmail(session?.customer_details);

  if (session?.payment_status !== "paid" || !sessionId || !workspaceId) {
    await db
      .insert(stripeEvents)
      .values({ id: event.id, type: event.type })
      .onConflictDoNothing();
    return true;
  }

  let refund = false;
  let grantedSeat: number | null = null;
  await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(stripeEvents)
      .values({ id: event.id, type: event.type })
      .onConflictDoNothing()
      .returning({ id: stripeEvents.id });
    if (!claimed[0]) return;

    const deals = await tx
      .select()
      .from(lifetimeDeals)
      .where(eq(lifetimeDeals.workspaceId, workspaceId))
      .limit(1)
      .for("update");
    const deal = deals[0];
    if (deal?.status === "active") return;

    const seats = await tx
      .select()
      .from(lifetimeSeats)
      .where(eq(lifetimeSeats.workspaceId, workspaceId))
      .limit(1)
      .for("update");
    const seat = seats[0];
    const reserved =
      deal?.status === "reserved" &&
      seat?.status === "reserved" &&
      (!deal.stripeCheckoutSessionId || deal.stripeCheckoutSessionId === sessionId);

    if (!deal || !seat || !reserved) {
      // Payment landed after the reservation expired or the seat was taken.
      // Never grant a 101st seat: mark what exists and refund the charge.
      refund = true;
      if (deal) {
        await tx
          .update(lifetimeDeals)
          .set({
            status: "refunded",
            refundedAt: new Date(),
            stripePaymentIntentId: paymentIntent,
            updatedAt: new Date(),
          })
          .where(eq(lifetimeDeals.workspaceId, workspaceId));
      }
      return;
    }

    const now = new Date();
    await tx
      .update(lifetimeDeals)
      .set({
        status: "active",
        stripeCheckoutSessionId: sessionId,
        stripePaymentIntentId: paymentIntent,
        amountCents: amount ?? deal.amountCents,
        grantedAt: now,
        reservedUntil: null,
        updatedAt: now,
      })
      .where(eq(lifetimeDeals.workspaceId, workspaceId));

    await tx
      .update(lifetimeSeats)
      .set({ status: "active", reservedUntil: null, updatedAt: now })
      .where(eq(lifetimeSeats.seatNumber, seat.seatNumber));

    await tx
      .insert(workspaceSubscriptions)
      .values({
        workspaceId,
        plan: "lifetime",
        status: "lifetime",
        stripeCustomerId: customerId,
        stripeSubscriptionId: null,
        stripePriceId: null,
        trialEndsAt: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: workspaceSubscriptions.workspaceId,
        set: {
          plan: "lifetime",
          status: "lifetime",
          stripeCustomerId: customerId,
          stripeSubscriptionId: null,
          stripePriceId: null,
          trialEndsAt: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          updatedAt: now,
        },
      });

    await tx
      .update(workspaces)
      .set({ plan: "lifetime", updatedAt: now })
      .where(eq(workspaces.id, workspaceId));

    grantedSeat = seat.seatNumber;
  });

  if (grantedSeat !== null) {
    await sendLifetimeEmail({ to: email, seatNumber: grantedSeat, kind: "granted" });
  }

  if (refund) {
    await sendLifetimeEmail({ to: email, seatNumber: 0, kind: "unavailable" });
  }

  if (refund && paymentIntent) {
    const result = await refundStripePaymentIntent(paymentIntent);
    if (!result.ok) {
      logEvent("error", "billing.lifetime_refund_failed", {
        eventId: event.id,
        workspaceId,
        error: result.error,
      });
    }
  }

  return true;
}

/** True when a workspace already holds an active lifetime purchase. */
export async function workspaceHasLifetimePurchase(workspaceId: string): Promise<boolean> {
  const rows = await db
    .select({ status: lifetimeDeals.status })
    .from(lifetimeDeals)
    .where(
      and(
        eq(lifetimeDeals.workspaceId, workspaceId),
        or(
          eq(lifetimeDeals.status, "active"),
          eq(lifetimeDeals.status, "reserved"),
        ),
      ),
    )
    .limit(1);
  return Boolean(rows[0]);
}

