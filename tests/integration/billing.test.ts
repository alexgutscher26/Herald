import { afterAll, beforeAll, describe, expect } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import {
  jobs,
  lifetimeDeals,
  lifetimeSeats,
  workspaceSubscriptions,
  workspaces,
} from "@/db/schema";
import { checkBoardLimit, getWorkspacePlan } from "@/features/entitlements/entitlements";
import { applyStripeEvent, startCheckout } from "@/features/billing/service";
import { expireDunning } from "@/features/billing/expire";
import {
  getLifetimeAvailability,
  startLifetimeCheckout,
} from "@/features/billing/lifetime";
import { enqueueTrialReminders } from "@/features/billing/schedule";

import {
  createBoard,
  createProduct,
  createUser,
  createWorkspace,
} from "./factories";
import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";

const BILLING_ENV = {
  STRIPE_SECRET_KEY: "sk_" + "test_billing",
  STRIPE_WEBHOOK_SECRET: "whsec_billing",
  STRIPE_PRICE_STARTER: "price_starter",
  STRIPE_PRICE_PRO: "price_pro",
  STRIPE_PRICE_LIFETIME: "price_lifetime",
  STRIPE_API_URL: "http://127.0.0.1:9",
} as const;

let previous: Record<string, string | undefined> = {};

beforeAll(async () => {
  previous = Object.fromEntries(
    Object.keys(BILLING_ENV).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, BILLING_ENV);
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await teardownTestDatabase();
});

function subscriptionEvent(input: {
  id: string;
  type: string;
  workspaceId: string;
  status: string;
  created?: number;
}) {
  return {
    id: input.id,
    type: input.type,
    ...(input.created ? { created: input.created } : {}),
    data: {
      object: {
        id: "sub_billing_1",
        customer: "cus_billing_1",
        status: input.status,
        metadata: { workspace_id: input.workspaceId },
        items: { data: [{ price: { id: "price_pro" } }] },
        trial_end: 1_800_000_000,
        current_period_end: 1_802_592_000,
        cancel_at_period_end: false,
      },
    },
  };
}

describe("Stripe subscription sync", () => {
  isolatedTest("a webhook makes the subscription the source of truth", async () => {
    const workspace = await createWorkspace({ plan: "free" });

    await applyStripeEvent(
      subscriptionEvent({
        id: "evt_billing_active",
        type: "customer.subscription.updated",
        workspaceId: workspace.id,
        status: "active",
      }),
    );

    expect(await getWorkspacePlan(workspace.id)).toBe("pro");

    const [subscription] = await db
      .select()
      .from(workspaceSubscriptions)
      .where(eq(workspaceSubscriptions.workspaceId, workspace.id));
    expect(subscription).toMatchObject({
      plan: "pro",
      status: "active",
      stripeCustomerId: "cus_billing_1",
      stripeSubscriptionId: "sub_billing_1",
      stripePriceId: "price_pro",
    });

    // The denormalised workspace column is refreshed, but it is not the
    // authority: a later cancellation returns the workspace to Free even if
    // someone edits workspaces.plan directly.
    await db.update(workspaces).set({ plan: "pro" }).where(eq(workspaces.id, workspace.id));
    await applyStripeEvent(
      subscriptionEvent({
        id: "evt_billing_canceled",
        type: "customer.subscription.deleted",
        workspaceId: workspace.id,
        status: "canceled",
      }),
    );

    expect(await getWorkspacePlan(workspace.id)).toBe("free");
    const [canceled] = await db
      .select({ status: workspaceSubscriptions.status, plan: workspaceSubscriptions.plan })
      .from(workspaceSubscriptions)
      .where(eq(workspaceSubscriptions.workspaceId, workspace.id));
    expect(canceled).toEqual({ status: "canceled", plan: "pro" });
  });

  isolatedTest("a webhook upgrade lifts the free board limit immediately", async () => {
    const workspace = await createWorkspace({ plan: "free" });
    const product = await createProduct(workspace.id);
    await createBoard(product.id);
    await createBoard(product.id);

    expect(await checkBoardLimit(product.id, 1)).toMatchObject({
      plan: "free",
      limit: 2,
      allowed: false,
    });

    await applyStripeEvent(
      subscriptionEvent({
        id: "evt_billing_board_upgrade",
        type: "customer.subscription.updated",
        workspaceId: workspace.id,
        status: "active",
      }),
    );

    expect(await checkBoardLimit(product.id, 1)).toMatchObject({
      plan: "pro",
      limit: null,
      allowed: true,
    });
  });

  isolatedTest("replays are idempotent", async () => {
    const workspace = await createWorkspace({ plan: "free" });
    const event = subscriptionEvent({
      id: "evt_billing_once",
      type: "customer.subscription.created",
      workspaceId: workspace.id,
      status: "trialing",
    });

    await applyStripeEvent(event);
    await applyStripeEvent(event);

    expect(await getWorkspacePlan(workspace.id)).toBe("pro");
  });

  isolatedTest("an out-of-order cancellation cannot undo a newer activation", async () => {
    const workspace = await createWorkspace({ plan: "free" });

    await applyStripeEvent(
      subscriptionEvent({
        id: "evt_billing_order_active",
        type: "customer.subscription.updated",
        workspaceId: workspace.id,
        status: "active",
        created: 2_000_000_000,
      }),
    );
    await applyStripeEvent(
      subscriptionEvent({
        id: "evt_billing_order_stale_cancel",
        type: "customer.subscription.deleted",
        workspaceId: workspace.id,
        status: "canceled",
        created: 1_999_999_999,
      }),
    );

    expect(await getWorkspacePlan(workspace.id)).toBe("pro");

    await applyStripeEvent(
      subscriptionEvent({
        id: "evt_billing_order_new_cancel",
        type: "customer.subscription.deleted",
        workspaceId: workspace.id,
        status: "canceled",
        created: 2_000_000_001,
      }),
    );
    expect(await getWorkspacePlan(workspace.id)).toBe("free");
  });
});

async function reserveLifetimeSeat(input: {
  workspaceId: string;
  purchaserUserId?: string;
  seatNumber?: number;
  sessionId?: string;
}) {
  const seatNumber = input.seatNumber ?? 1;
  const sessionId = input.sessionId ?? "cs_lifetime_test";
  await db
    .update(lifetimeSeats)
    .set({
      status: "reserved",
      workspaceId: input.workspaceId,
      reservedUntil: new Date(Date.now() + 60 * 60 * 1000),
      updatedAt: new Date(),
    })
    .where(eq(lifetimeSeats.seatNumber, seatNumber));
  await db.insert(lifetimeDeals).values({
    workspaceId: input.workspaceId,
    purchaserUserId: input.purchaserUserId ?? null,
    seatNumber,
    stripeCheckoutSessionId: sessionId,
    status: "reserved",
    reservedUntil: new Date(Date.now() + 60 * 60 * 1000),
  });
  return { seatNumber, sessionId };
}

function lifetimePaidEvent(input: {
  id: string;
  workspaceId: string;
  sessionId: string;
  paymentIntent?: string;
}) {
  return {
    id: input.id,
    type: "checkout.session.completed",
    data: {
      object: {
        id: input.sessionId,
        mode: "payment",
        payment_status: "paid",
        customer: "cus_lifetime_test",
        customer_details: { email: "founder@example.test" },
        payment_intent: input.paymentIntent ?? "pi_lifetime_test",
        amount_total: 49_900,
        client_reference_id: input.workspaceId,
        metadata: {
          offer: "lifetime",
          workspace_id: input.workspaceId,
        },
      },
    },
  };
}

describe("Founding Lifetime", () => {
  isolatedTest("a paid session grants one seat and the lifetime plan once", async () => {
    const workspace = await createWorkspace({ plan: "free" });
    const { sessionId } = await reserveLifetimeSeat({ workspaceId: workspace.id });
    const event = lifetimePaidEvent({
      id: "evt_lifetime_paid",
      workspaceId: workspace.id,
      sessionId,
    });

    await applyStripeEvent(event);
    await applyStripeEvent(event);

    expect(await getWorkspacePlan(workspace.id)).toBe("lifetime");

    const deals = await db
      .select()
      .from(lifetimeDeals)
      .where(eq(lifetimeDeals.workspaceId, workspace.id));
    expect(deals).toHaveLength(1);
    expect(deals[0]).toMatchObject({
      status: "active",
      seatNumber: 1,
      stripePaymentIntentId: "pi_lifetime_test",
      amountCents: 49_900,
    });

    const [seat] = await db
      .select({ status: lifetimeSeats.status, workspaceId: lifetimeSeats.workspaceId })
      .from(lifetimeSeats)
      .where(eq(lifetimeSeats.seatNumber, 1));
    expect(seat).toEqual({ status: "active", workspaceId: workspace.id });

    const [subscription] = await db
      .select()
      .from(workspaceSubscriptions)
      .where(eq(workspaceSubscriptions.workspaceId, workspace.id));
    expect(subscription).toMatchObject({
      plan: "lifetime",
      status: "lifetime",
      stripeSubscriptionId: null,
      stripePriceId: null,
    });
  });

  isolatedTest("an expired checkout releases the reserved seat", async () => {
    const workspace = await createWorkspace({ plan: "free" });
    const { sessionId } = await reserveLifetimeSeat({
      workspaceId: workspace.id,
      seatNumber: 2,
      sessionId: "cs_lifetime_expired",
    });

    await applyStripeEvent({
      id: "evt_lifetime_expired",
      type: "checkout.session.expired",
      data: {
        object: {
          id: sessionId,
          mode: "payment",
          metadata: { offer: "lifetime", workspace_id: workspace.id },
        },
      },
    });

    expect(
      await db
        .select({ workspaceId: lifetimeDeals.workspaceId })
        .from(lifetimeDeals)
        .where(eq(lifetimeDeals.workspaceId, workspace.id)),
    ).toHaveLength(0);

    const [seat] = await db
      .select({ status: lifetimeSeats.status, workspaceId: lifetimeSeats.workspaceId })
      .from(lifetimeSeats)
      .where(eq(lifetimeSeats.seatNumber, 2));
    expect(seat).toEqual({ status: "available", workspaceId: null });
  });

  isolatedTest("a full refund revokes lifetime and frees the seat", async () => {
    const workspace = await createWorkspace({ plan: "free" });
    const { sessionId } = await reserveLifetimeSeat({
      workspaceId: workspace.id,
      seatNumber: 3,
      sessionId: "cs_lifetime_refund",
    });
    await applyStripeEvent(
      lifetimePaidEvent({
        id: "evt_lifetime_refund_paid",
        workspaceId: workspace.id,
        sessionId,
        paymentIntent: "pi_lifetime_refund",
      }),
    );

    await applyStripeEvent({
      id: "evt_lifetime_refund",
      type: "charge.refunded",
      data: {
        object: {
          payment_intent: "pi_lifetime_refund",
          amount: 49_900,
          amount_refunded: 49_900,
          refunded: true,
        },
      },
    });

    expect(await getWorkspacePlan(workspace.id)).toBe("free");
    const [deal] = await db
      .select({ status: lifetimeDeals.status, refundedAt: lifetimeDeals.refundedAt })
      .from(lifetimeDeals)
      .where(eq(lifetimeDeals.workspaceId, workspace.id));
    expect(deal?.status).toBe("refunded");
    expect(deal?.refundedAt).not.toBeNull();

    const [seat] = await db
      .select({ status: lifetimeSeats.status })
      .from(lifetimeSeats)
      .where(eq(lifetimeSeats.seatNumber, 3));
    expect(seat?.status).toBe("available");
  });

  isolatedTest("a partial refund does not revoke lifetime", async () => {
    const workspace = await createWorkspace({ plan: "free" });
    const { sessionId } = await reserveLifetimeSeat({
      workspaceId: workspace.id,
      seatNumber: 4,
      sessionId: "cs_lifetime_partial",
    });
    await applyStripeEvent(
      lifetimePaidEvent({
        id: "evt_lifetime_partial_paid",
        workspaceId: workspace.id,
        sessionId,
        paymentIntent: "pi_lifetime_partial",
      }),
    );

    await applyStripeEvent({
      id: "evt_lifetime_partial_refund",
      type: "charge.refunded",
      data: {
        object: {
          payment_intent: "pi_lifetime_partial",
          amount: 49_900,
          amount_refunded: 1_000,
          refunded: false,
        },
      },
    });

    expect(await getWorkspacePlan(workspace.id)).toBe("lifetime");
  });

  isolatedTest("subscription events cannot downgrade a lifetime workspace", async () => {
    const workspace = await createWorkspace({ plan: "free" });
    const { sessionId } = await reserveLifetimeSeat({
      workspaceId: workspace.id,
      seatNumber: 5,
      sessionId: "cs_lifetime_guard",
    });
    await applyStripeEvent(
      lifetimePaidEvent({
        id: "evt_lifetime_guard_paid",
        workspaceId: workspace.id,
        sessionId,
      }),
    );

    await applyStripeEvent(
      subscriptionEvent({
        id: "evt_lifetime_guard_cancel",
        type: "customer.subscription.deleted",
        workspaceId: workspace.id,
        status: "canceled",
      }),
    );

    expect(await getWorkspacePlan(workspace.id)).toBe("lifetime");
  });

  isolatedTest("a lifetime workspace cannot start a subscription checkout", async () => {
    const workspace = await createWorkspace({ plan: "free" });
    const { sessionId } = await reserveLifetimeSeat({
      workspaceId: workspace.id,
      seatNumber: 6,
      sessionId: "cs_lifetime_no_switch",
    });
    await applyStripeEvent(
      lifetimePaidEvent({
        id: "evt_lifetime_no_switch_paid",
        workspaceId: workspace.id,
        sessionId,
      }),
    );

    const result = await startCheckout({
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
      email: "founder@example.test",
      plan: "pro",
    });
    expect(result.ok).toBe(false);
  });

  isolatedTest("one seat per purchaser account is enforced in the database", async () => {
    const purchaser = await createUser();
    const first = await createWorkspace({ plan: "free" });
    const second = await createWorkspace({ plan: "free" });
    await reserveLifetimeSeat({
      workspaceId: first.id,
      purchaserUserId: purchaser.id,
      seatNumber: 7,
      sessionId: "cs_lifetime_purchaser_one",
    });

    let rejected = false;
    try {
      await reserveLifetimeSeat({
        workspaceId: second.id,
        purchaserUserId: purchaser.id,
        seatNumber: 8,
        sessionId: "cs_lifetime_purchaser_two",
      });
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });

  isolatedTest("a sold-out ledger refuses before Stripe is called", async () => {
    const workspace = await createWorkspace({ plan: "free" });
    await db
      .update(lifetimeSeats)
      .set({ status: "active", workspaceId: null })
      .where(eq(lifetimeSeats.status, "available"));

    const availability = await getLifetimeAvailability();
    expect(availability).toMatchObject({ remaining: 0, soldOut: true });

    const result = await startLifetimeCheckout({
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
      purchaserUserId: "usr_not_reached",
      email: "founder@example.test",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("sold out");
  });
});

describe("billing lifecycle notices", () => {
  isolatedTest("a failed invoice keeps paid limits during grace and queues the dunning sequence", async () => {
    const workspace = await createWorkspace({ plan: "free" });

    await applyStripeEvent(
      subscriptionEvent({
        id: "evt_billing_pf_active",
        type: "customer.subscription.updated",
        workspaceId: workspace.id,
        status: "active",
      }),
    );
    expect(await getWorkspacePlan(workspace.id)).toBe("pro");

    const failed = {
      id: "evt_billing_pf",
      type: "invoice.payment_failed",
      data: {
        object: {
          customer: "cus_billing_1",
          amount_due: 4_900,
          currency: "usd",
          hosted_invoice_url: "https://billing.stripe.com/invoice/test",
          next_payment_attempt: 1_800_100_000,
        },
      },
    };

    // Stripe retries webhooks. The event marker makes the second delivery a
    // no-op, so an owner is never sent two dunning emails for one failure.
    await applyStripeEvent(failed);
    await applyStripeEvent(failed);

    expect(await getWorkspacePlan(workspace.id)).toBe("pro");
    const [subscription] = await db
      .select({
        status: workspaceSubscriptions.status,
        dunningGraceUntil: workspaceSubscriptions.dunningGraceUntil,
      })
      .from(workspaceSubscriptions)
      .where(eq(workspaceSubscriptions.workspaceId, workspace.id));
    expect(subscription?.status).toBe("past_due");
    expect(subscription?.dunningGraceUntil).not.toBeNull();

    const queued = await db
      .select({ type: jobs.type, payload: jobs.payload })
      .from(jobs)
      .where(eq(jobs.type, "send_billing_email"));
    expect(queued.length).toBeGreaterThanOrEqual(3);
    expect(queued.map((row) => (row.payload as { kind: string }).kind)).toEqual(
      expect.arrayContaining(["dunning_reminder", "dunning_final"]),
    );

    const expiries = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.type, "expire_dunning"));
    expect(expiries).toHaveLength(1);

    await db
      .update(workspaceSubscriptions)
      .set({ dunningGraceUntil: new Date(Date.now() - 60_000) })
      .where(eq(workspaceSubscriptions.workspaceId, workspace.id));
    expect(
      await expireDunning({
        workspaceId: workspace.id,
        graceUntil: new Date(Date.now() - 60_000).toISOString(),
      }),
    ).toEqual({ expired: true });
    expect(await getWorkspacePlan(workspace.id)).toBe("free");
  });

  isolatedTest("trial reminders are queued once per trial period", async () => {
    const workspace = await createWorkspace({ plan: "free" });
    const now = new Date();
    const trialEnd = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

    await db
      .insert(workspaceSubscriptions)
      .values({
        workspaceId: workspace.id,
        plan: "pro",
        status: "trialing",
        stripeCustomerId: "cus_trial_reminder",
        trialEndsAt: trialEnd,
        cancelAtPeriodEnd: false,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: workspaceSubscriptions.workspaceId,
        set: {
          plan: "pro",
          status: "trialing",
          stripeCustomerId: "cus_trial_reminder",
          trialEndsAt: trialEnd,
          cancelAtPeriodEnd: false,
          updatedAt: now,
        },
      });

    const first = await enqueueTrialReminders(now);
    const second = await enqueueTrialReminders(now);

    expect(first.queued).toBe(1);
    expect(second.queued).toBe(0);

    const noticeKey = trialEnd.toISOString().slice(0, 10);
    const rows = await db
      .select({ type: jobs.type, payload: jobs.payload })
      .from(jobs)
      .where(eq(jobs.dedupeKey, `billing-trial:${workspace.id}:${noticeKey}`));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe("send_billing_email");
    expect(rows[0]?.payload).toMatchObject({ kind: "trial_ending", noticeKey });
  });
});
