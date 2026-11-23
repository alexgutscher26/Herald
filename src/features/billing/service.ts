import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import {
  billingChurnFeedback,
  lifetimeDeals,
  stripeEvents,
  workspaces,
  workspaceSubscriptions,
} from "@/db/schema";
import { getWorkspacePlan } from "@/features/entitlements/entitlements";
import { isWorkspaceSetupComplete } from "@/features/overview/setup";
import { logEvent, serializeError } from "@/lib/logger";

import {
  annualBillingConfigured,
  getBillingConfig,
  intervalForPriceId,
  planForPriceId,
  priceIdForPlanInterval,
  type BillingInterval,
  type PaidPlan,
} from "./config";
import {
  applyLifetimeStripeEvent,
  workspaceHasLifetimePurchase,
} from "./lifetime";
import { trialDaysForSetup } from "./trial";
import {
  createStripeCheckoutSession,
  createStripeCustomer,
  createStripePortalSession,
  extendStripeTrial,
  listStripeInvoices,
  previewStripeProration,
  retrieveStripeSubscription,
  syncStripeCustomer,
  updateStripeSubscriptionPrice,
} from "./stripe";
import { enqueueJob } from "@/features/jobs/queue";
import {
  dunningGraceUntil,
  dunningReminderAt,
  isOlderStripeEvent,
  nextTrialEnd,
} from "./policy";
import type { BillingNotice } from "./notifications";

/**
 * Billing service.
 *
 * Checkout and Portal are server-created URLs. The browser never receives a
 * Stripe secret or a price id, and it cannot write a plan. The only writer of
 * a paid entitlement is `applyStripeEvent`, which is called from the signed
 * webhook.
 */

export type BillingView = {
  configured: boolean;
  plan: "free" | "starter" | "pro" | "lifetime";
  planName: string;
  status: string;
  hasCustomer: boolean;
  trialEndsAt: string | null;
  /** Whole days until the trial ends; null when there is no trial. */
  trialDaysLeft: number | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  billingInterval: BillingInterval;
  annualConfigured: boolean;
  /** End of the paid-entitlement grace after a failed payment. */
  graceEndsAt: string | null;
  taxAutomatic: boolean;
  prices: Record<PaidPlan, string>;
  /** The optional one-time price is present, so the offer can be opened. */
  lifetimeConfigured: boolean;
  invoices: BillingInvoice[];
  invoiceError: string | null;
  cancellationFeedback: {
    reason: string;
    details: string | null;
    createdAt: string;
    recoveredAt: string | null;
  } | null;
  /** Present only for an active Founding Lifetime purchase. */
  lifetime: {
    seatNumber: number;
    purchasedAt: string | null;
    amountCents: number;
    receiptUrl: string | null;
  } | null;
};

export type BillingInvoice = {
  id: string;
  number: string | null;
  status: string | null;
  total: number;
  currency: string;
  createdAt: string;
  invoiceUrl: string | null;
  pdfUrl: string | null;
};

const PLAN_NAMES = {
  free: "Free",
  starter: "Indie",
  pro: "Professional",
  lifetime: "Founding Lifetime",
} as const;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function getBillingView(workspaceId: string): Promise<BillingView> {
  const [plan, rows] = await Promise.all([
    getWorkspacePlan(workspaceId),
    db
      .select()
      .from(workspaceSubscriptions)
      .where(eq(workspaceSubscriptions.workspaceId, workspaceId))
      .limit(1),
  ]);

  const row = rows[0];

  let configured = false;
  let annualConfigured = false;
  let taxAutomatic = false;
  try {
    const config = getBillingConfig();
    configured = config !== null;
    annualConfigured = annualBillingConfigured(config);
    taxAutomatic = configured;
  } catch {
    configured = false;
  }

  let invoices: BillingInvoice[] = [];
  let invoiceError: string | null = null;
  if (configured && row?.stripeCustomerId) {
    const invoiceResult = await listStripeInvoices(row.stripeCustomerId);
    if (invoiceResult.ok) {
      invoices = invoiceResult.invoices.map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        status: invoice.status,
        total: invoice.total,
        currency: invoice.currency,
        createdAt: new Date(invoice.created * 1000).toISOString(),
        invoiceUrl: invoice.hosted_invoice_url,
        pdfUrl: invoice.invoice_pdf,
      }));
    } else {
      invoiceError = "Invoice history is temporarily unavailable.";
      logEvent("warn", "billing.invoices_unavailable", {
        workspaceId,
        error: invoiceResult.error,
      });
    }
  }

  const dealRows = await db
    .select()
    .from(lifetimeDeals)
    .where(eq(lifetimeDeals.workspaceId, workspaceId))
    .limit(1);
  const deal = dealRows[0];
  const feedbackRows = await db
    .select({
      reason: billingChurnFeedback.reason,
      details: billingChurnFeedback.details,
      createdAt: billingChurnFeedback.createdAt,
      recoveredAt: billingChurnFeedback.recoveredAt,
    })
    .from(billingChurnFeedback)
    .where(eq(billingChurnFeedback.workspaceId, workspaceId))
    .orderBy(desc(billingChurnFeedback.createdAt))
    .limit(1);
  const feedback = feedbackRows[0];
  const lifetime =
    plan === "lifetime" && deal && deal.status === "active"
      ? {
          seatNumber: deal.seatNumber,
          purchasedAt: deal.grantedAt?.toISOString() ?? null,
          amountCents: deal.amountCents,
          receiptUrl: invoices.find((invoice) => invoice.invoiceUrl)?.invoiceUrl ?? null,
        }
      : null;

  return {
    configured,
    plan,
    planName: PLAN_NAMES[plan],
    status: row?.status ?? "free",
    hasCustomer: Boolean(row?.stripeCustomerId),
    trialEndsAt: row?.trialEndsAt?.toISOString() ?? null,
    trialDaysLeft: row?.trialEndsAt
      ? Math.max(0, Math.ceil((row.trialEndsAt.getTime() - Date.now()) / DAY_MS))
      : null,
    currentPeriodEnd: row?.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: row?.cancelAtPeriodEnd ?? false,
    billingInterval: row?.billingInterval === "annual" ? "annual" : "monthly",
    annualConfigured,
    graceEndsAt: row?.dunningGraceUntil?.toISOString() ?? null,
    taxAutomatic,
    prices: {
      starter: process.env.STRIPE_PRICE_STARTER?.trim() ? "configured" : "",
      pro: process.env.STRIPE_PRICE_PRO?.trim() ? "configured" : "",
    },
    lifetimeConfigured: Boolean(process.env.STRIPE_PRICE_LIFETIME?.trim()),
    invoices,
    invoiceError,
    cancellationFeedback: feedback
      ? {
          reason: feedback.reason,
          details: feedback.details,
          createdAt: feedback.createdAt.toISOString(),
          recoveredAt: feedback.recoveredAt?.toISOString() ?? null,
        }
      : null,
    lifetime,
  };
}

async function ensureCustomer(input: {
  workspaceId: string;
  email: string;
  name: string;
  workspaceName: string;
}): Promise<{ ok: true; customerId: string } | { ok: false; error: string }> {
  const rows = await db
    .select({ customerId: workspaceSubscriptions.stripeCustomerId })
    .from(workspaceSubscriptions)
    .where(eq(workspaceSubscriptions.workspaceId, input.workspaceId))
    .limit(1);

  const existing = rows[0]?.customerId;
  if (existing) {
    // Best effort: a branding sync failure must not block checkout.
    await syncStripeCustomer({
      customerId: existing,
      name: input.workspaceName,
      invoiceFooter: invoiceFooter(input.workspaceName),
    }).catch(() => ({ ok: false as const, error: "customer sync failed" }));
    return { ok: true, customerId: existing };
  }

  const created = await createStripeCustomer({
    email: input.email,
    name: input.workspaceName || input.name,
    workspaceId: input.workspaceId,
    invoiceFooter: invoiceFooter(input.workspaceName),
  });
  if (!created.ok) return created;

  await db
    .insert(workspaceSubscriptions)
    .values({
      workspaceId: input.workspaceId,
      plan: "free",
      status: "free",
      stripeCustomerId: created.customer.id,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: workspaceSubscriptions.workspaceId,
      set: { stripeCustomerId: created.customer.id, updatedAt: new Date() },
    });

  return { ok: true, customerId: created.customer.id };
}

function invoiceFooter(workspaceName: string): string {
  return `Herald · ${workspaceName.trim() || "Workspace"} · Questions? Reply to this invoice.`;
}

export async function startCheckout(input: {
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  email: string;
  plan: PaidPlan;
  interval?: BillingInterval;
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
  const interval = input.interval ?? "monthly";
  if (interval === "annual" && !annualBillingConfigured(config)) {
    return { ok: false, error: "Annual billing is not configured on this deployment." };
  }

  if (await workspaceHasLifetimePurchase(input.workspaceId)) {
    return {
      ok: false,
      error:
        "This workspace has a Founding Lifetime purchase or a seat reserved for it. A subscription cannot replace lifetime access.",
    };
  }

  const current = await db
    .select({
      plan: workspaceSubscriptions.plan,
      status: workspaceSubscriptions.status,
      stripeCustomerId: workspaceSubscriptions.stripeCustomerId,
    })
    .from(workspaceSubscriptions)
    .where(eq(workspaceSubscriptions.workspaceId, input.workspaceId))
    .limit(1);

  if (current[0]?.plan === "lifetime" || current[0]?.status === "lifetime") {
    return {
      ok: false,
      error:
        "This workspace has Founding Lifetime and cannot move to a subscription. Lifetime is not refundable by switching.",
    };
  }

  if (
    current[0]?.status === "active" ||
    current[0]?.status === "trialing"
  ) {
    return {
      ok: false,
      error: "This workspace already has an active subscription. Use Manage billing instead.",
    };
  }

  const setupComplete = await isWorkspaceSetupComplete(input.workspaceId);

  const customer = await ensureCustomer({
    workspaceId: input.workspaceId,
    email: input.email,
    name: input.workspaceName,
    workspaceName: input.workspaceName,
  });
  if (!customer.ok) return customer;

  const origin = config.APP_URL;
  const settingsUrl = `${origin}/app/${encodeURIComponent(
    input.workspaceSlug,
  )}/settings`;
  const session = await createStripeCheckoutSession({
    customerId: customer.customerId,
    priceId: priceIdForPlanInterval(config, input.plan, interval),
    plan: input.plan,
    interval,
    workspaceId: input.workspaceId,
    trialDays: trialDaysForSetup(setupComplete),
    successUrl: `${settingsUrl}?billing=success`,
    cancelUrl: `${settingsUrl}?billing=cancelled`,
  });
  if (!session.ok) return session;
  if (!session.session.url) return { ok: false, error: "Stripe did not return a checkout URL." };

  return { ok: true, url: session.session.url };
}

export async function startBillingPortal(input: {
  workspaceId: string;
  workspaceSlug: string;
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

  const rows = await db
    .select({ customerId: workspaceSubscriptions.stripeCustomerId })
    .from(workspaceSubscriptions)
    .where(eq(workspaceSubscriptions.workspaceId, input.workspaceId))
    .limit(1);

  const customerId = rows[0]?.customerId;
  if (!customerId) {
    return { ok: false, error: "Choose a paid plan before opening the billing portal." };
  }

  const portal = await createStripePortalSession({
    customerId,
    returnUrl: `${config.APP_URL}/app/${encodeURIComponent(input.workspaceSlug)}/settings`,
  });
  if (!portal.ok) return portal;
  return { ok: true, url: portal.portal.url };
}

export type PlanChangePreview = {
  plan: PaidPlan;
  interval: BillingInterval;
  amountDue: number;
  total: number;
  startingBalance: number;
  currency: string;
  nextPaymentAt: string | null;
};

async function planChangeContext(input: {
  workspaceId: string;
  plan: PaidPlan;
  interval: BillingInterval;
}): Promise<
  | {
      ok: true;
      customerId: string;
      subscriptionId: string;
      itemId: string;
      priceId: string;
      currentPriceId: string | null;
    }
  | { ok: false; error: string }
> {
  let config;
  try {
    config = getBillingConfig();
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Billing configuration is invalid.",
    };
  }
  if (!config) return { ok: false, error: "Stripe billing is not configured on this deployment." };
  if (input.interval === "annual" && !annualBillingConfigured(config)) {
    return { ok: false, error: "Annual billing is not configured on this deployment." };
  }

  const rows = await db
    .select({
      customerId: workspaceSubscriptions.stripeCustomerId,
      subscriptionId: workspaceSubscriptions.stripeSubscriptionId,
      status: workspaceSubscriptions.status,
    })
    .from(workspaceSubscriptions)
    .where(eq(workspaceSubscriptions.workspaceId, input.workspaceId))
    .limit(1);
  const row = rows[0];
  if (!row?.customerId || !row.subscriptionId) {
    return { ok: false, error: "This workspace does not have an active Stripe subscription." };
  }
  if (row.status !== "active" && row.status !== "trialing") {
    return {
      ok: false,
      error: "Update the payment method before changing plans.",
    };
  }

  const fetched = await retrieveStripeSubscription(row.subscriptionId);
  if (!fetched.ok) return fetched;
  const item = fetched.subscription.items?.data?.[0];
  if (!item?.id) {
    return { ok: false, error: "Stripe did not return a subscription item to change." };
  }

  return {
    ok: true,
    customerId: row.customerId,
    subscriptionId: row.subscriptionId,
    itemId: item.id,
    priceId: priceIdForPlanInterval(config, input.plan, input.interval),
    currentPriceId: item.price?.id ?? null,
  };
}

export async function previewPlanChange(input: {
  workspaceId: string;
  plan: PaidPlan;
  interval: BillingInterval;
}): Promise<{ ok: true; preview: PlanChangePreview } | { ok: false; error: string }> {
  const context = await planChangeContext(input);
  if (!context.ok) return context;
  const preview = await previewStripeProration({
    customerId: context.customerId,
    subscriptionId: context.subscriptionId,
    itemId: context.itemId,
    priceId: context.priceId,
  });
  if (!preview.ok) return preview;
  return {
    ok: true,
    preview: { plan: input.plan, interval: input.interval, ...preview.preview },
  };
}

/** Apply the price change immediately; Stripe's webhook is the plan writer. */
export async function changePlan(input: {
  workspaceId: string;
  plan: PaidPlan;
  interval: BillingInterval;
}): Promise<{ ok: true; plan: PaidPlan; interval: BillingInterval } | { ok: false; error: string }> {
  const context = await planChangeContext(input);
  if (!context.ok) return context;
  if (context.currentPriceId === context.priceId) {
    return { ok: false, error: "This workspace is already on that plan and billing period." };
  }
  const updated = await updateStripeSubscriptionPrice({
    subscriptionId: context.subscriptionId,
    itemId: context.itemId,
    priceId: context.priceId,
    plan: input.plan,
    interval: input.interval,
  });
  if (!updated.ok) return updated;
  logEvent("info", "billing.plan_change_requested", {
    workspaceId: input.workspaceId,
    plan: input.plan,
    interval: input.interval,
  });
  return { ok: true, plan: input.plan, interval: input.interval };
}

export async function extendWorkspaceTrial(input: {
  workspaceId: string;
  days: number;
}): Promise<
  | { ok: true; previousTrialEndsAt: string | null; trialEndsAt: string }
  | { ok: false; error: string }
> {
  const rows = await db
    .select({
      status: workspaceSubscriptions.status,
      stripeSubscriptionId: workspaceSubscriptions.stripeSubscriptionId,
      trialEndsAt: workspaceSubscriptions.trialEndsAt,
    })
    .from(workspaceSubscriptions)
    .where(eq(workspaceSubscriptions.workspaceId, input.workspaceId))
    .limit(1);
  const row = rows[0];
  if (!row || row.status !== "trialing" || !row.stripeSubscriptionId) {
    return { ok: false, error: "Only a trialing Stripe subscription can be extended." };
  }

  const nextEnd = nextTrialEnd(row.trialEndsAt, new Date(), input.days);
  const extended = await extendStripeTrial({
    subscriptionId: row.stripeSubscriptionId,
    trialEnd: nextEnd,
  });
  if (!extended.ok) return extended;

  await db
    .update(workspaceSubscriptions)
    .set({ trialEndsAt: nextEnd, updatedAt: new Date() })
    .where(eq(workspaceSubscriptions.workspaceId, input.workspaceId));

  return {
    ok: true,
    previousTrialEndsAt: row.trialEndsAt?.toISOString() ?? null,
    trialEndsAt: nextEnd.toISOString(),
  };
}

export async function recordBillingChurnFeedback(input: {
  workspaceId: string;
  userId: string;
  kind: "cancellation" | "refund";
  reason: string;
  details: string | null;
  contactConsent: boolean;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const inserted = await db
    .insert(billingChurnFeedback)
    .values({
      workspaceId: input.workspaceId,
      userId: input.userId,
      kind: input.kind,
      reason: input.reason.trim().slice(0, 300),
      details: input.details?.trim().slice(0, 2_000) || null,
      contactConsent: input.contactConsent,
    })
    .returning({ id: billingChurnFeedback.id });
  const row = inserted[0];
  if (!row) return { ok: false, error: "Could not save the feedback." };

  const subscription = await db
    .select({ status: workspaceSubscriptions.status })
    .from(workspaceSubscriptions)
    .where(eq(workspaceSubscriptions.workspaceId, input.workspaceId))
    .limit(1);
  const status = subscription[0]?.status;
  if (input.contactConsent && (status === "canceled" || status === "unpaid")) {
    await enqueueBillingWinback(input.workspaceId, row.id);
  }
  return { ok: true, id: row.id };
}

async function enqueueBillingWinback(workspaceId: string, feedbackId?: string): Promise<void> {
  const rows = await db
    .select({ id: billingChurnFeedback.id, reason: billingChurnFeedback.reason })
    .from(billingChurnFeedback)
    .where(
      feedbackId
        ? and(
            eq(billingChurnFeedback.id, feedbackId),
            eq(billingChurnFeedback.workspaceId, workspaceId),
          )
        : and(
            eq(billingChurnFeedback.workspaceId, workspaceId),
            eq(billingChurnFeedback.contactConsent, true),
          ),
    )
    .orderBy(desc(billingChurnFeedback.createdAt))
    .limit(1);
  const feedback = rows[0];
  if (!feedback) return;

  await enqueueJob({
    type: "send_billing_email",
    payload: {
      workspaceId,
      kind: "billing_winback",
      noticeKey: feedback.id,
      feedbackId: feedback.id,
    },
    dedupeKey: `billing-winback:${feedback.id}`,
  }).catch((error) => {
    logEvent("error", "billing.winback_enqueue_failed", {
      workspaceId,
      error: serializeError(error),
    });
  });
}

type SubscriptionObject = {
  id?: unknown;
  customer?: unknown;
  status?: unknown;
  cancel_at_period_end?: unknown;
  trial_end?: unknown;
  current_period_end?: unknown;
  metadata?: unknown;
  items?: { data?: Array<{ id?: unknown; price?: { id?: unknown } }> } | null;
};

type StripeEvent = {
  id: string;
  type: string;
  /** Stripe's Unix creation time; used to ignore stale deliveries. */
  created?: number;
  data?: { object?: unknown };
};

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function dateFromUnix(value: unknown): Date | null {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value * 1000)
    : null;
}

function planFromSubscription(
  subscription: SubscriptionObject,
  fallback: PaidPlan | null,
): PaidPlan | null {
  let config;
  try {
    config = getBillingConfig();
  } catch {
    return fallback;
  }
  if (!config) return fallback;

  const priceId = subscription.items?.data?.[0]?.price?.id;
  if (typeof priceId === "string") {
    const mapped = planForPriceId(config, priceId);
    if (mapped) return mapped;
  }

  const metadataPlan = subscription.metadata as Record<string, unknown> | undefined;
  return stringValue(metadataPlan?.plan) === "pro"
    ? "pro"
    : stringValue(metadataPlan?.plan) === "starter"
      ? "starter"
      : fallback;
}

function intervalFromSubscription(subscription: SubscriptionObject): BillingInterval {
  try {
    const config = getBillingConfig();
    const priceId = subscription.items?.data?.[0]?.price?.id;
    if (config && typeof priceId === "string") {
      return intervalForPriceId(config, priceId);
    }
  } catch {
    // An invalid config must not block a webhook that can still set a plan.
  }
  return "monthly";
}

async function workspaceIdFor(input: {
  metadata: Record<string, unknown> | undefined;
  customerId: string | null;
}): Promise<string | null> {
  const fromMetadata = stringValue(input.metadata?.workspace_id);
  if (fromMetadata) return fromMetadata;

  if (input.customerId) {
    const rows = await db
      .select({ workspaceId: workspaceSubscriptions.workspaceId })
      .from(workspaceSubscriptions)
      .where(eq(workspaceSubscriptions.stripeCustomerId, input.customerId))
      .limit(1);
    if (rows[0]) return rows[0].workspaceId;
  }

  return null;
}

function subscriptionFromEvent(value: unknown): SubscriptionObject | null {
  if (!value || typeof value !== "object") return null;
  return value as SubscriptionObject;
}

/**
 * Apply one signed event exactly once.
 *
 * The event marker and the subscription update commit together. If Stripe
 * retries after a failure, the marker is gone and the work is retried; once it
 * succeeds, the primary key makes every replay a no-op.
 */
export async function applyStripeEvent(event: StripeEvent): Promise<void> {
  // Lifetime events are a separate lifecycle: one payment, no subscription.
  // The branch must come before every subscription handler, including refunds.
  if (await applyLifetimeStripeEvent(event)) return;

  if (event.type === "invoice.payment_failed") {
    await applyPaymentFailed(event);
    return;
  }

  let subscription: SubscriptionObject | null = null;
  let fallbackPlan: PaidPlan | null = null;

  if (event.type === "checkout.session.completed") {
    const session = event.data?.object as
      | {
          subscription?: unknown;
          customer?: unknown;
          metadata?: unknown;
          client_reference_id?: unknown;
        }
      | undefined;
    const subscriptionId = stringValue(session?.subscription);
    if (subscriptionId) {
      const fetched = await retrieveStripeSubscription(subscriptionId);
      if (!fetched.ok) throw new Error(fetched.error);
      subscription = fetched.subscription as SubscriptionObject;
    }

    if (session) {
      const metadata = session.metadata as Record<string, unknown> | undefined;
      const metadataPlan = stringValue(metadata?.plan);
      fallbackPlan =
        metadataPlan === "starter" || metadataPlan === "pro"
          ? metadataPlan
          : null;
    }
  } else if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    subscription = subscriptionFromEvent(event.data?.object);
  } else if (
    event.type === "invoice.payment_succeeded" ||
    event.type === "invoice.paid"
  ) {
    const invoice = event.data?.object as { subscription?: unknown } | undefined;
    const subscriptionId = stringValue(invoice?.subscription);
    if (subscriptionId) {
      const fetched = await retrieveStripeSubscription(subscriptionId);
      if (!fetched.ok) throw new Error(fetched.error);
      subscription = fetched.subscription as SubscriptionObject;
    }
  }

  let canceledWorkspaceId: string | null = null;

  await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(stripeEvents)
      .values({
        id: event.id,
        type: event.type,
        eventCreatedAt: event.created ? new Date(event.created * 1000) : null,
      })
      .onConflictDoNothing()
      .returning({ id: stripeEvents.id });
    if (!claimed[0]) return;

    if (!subscription) return;

    const metadata = subscription.metadata as Record<string, unknown> | undefined;
    const customerId = stringValue(subscription.customer);
    const workspaceId = await workspaceIdFor({ metadata, customerId });
    if (typeof workspaceId !== "string") {
      logEvent("warn", "billing.workspace_missing", {
        eventId: event.id,
        customerId,
      });
      return;
    }

    const targetWorkspaceId = String(workspaceId);

    // A stray subscription cancellation or update must never downgrade a
    // workspace that paid in full for lifetime access.
    const lifetime = await tx
      .select({ workspaceId: lifetimeDeals.workspaceId })
      .from(lifetimeDeals)
      .where(
        and(
          eq(lifetimeDeals.workspaceId, targetWorkspaceId),
          eq(lifetimeDeals.status, "active"),
        ),
      )
      .limit(1);
    if (lifetime[0]) return;

    const priceId = subscription.items?.data?.[0]?.price?.id;
    const stripePriceId = typeof priceId === "string" ? priceId : null;
    const plan = planFromSubscription(subscription, fallbackPlan);
    if (!plan) {
      logEvent("warn", "billing.price_unknown", {
        eventId: event.id,
        workspaceId,
      });
      return;
    }

    const status =
      event.type === "customer.subscription.deleted"
        ? "canceled"
        : stringValue(subscription.status) ?? "incomplete";

    const existing = await tx
      .select({
        plan: workspaceSubscriptions.plan,
        lastStripeEventAt: workspaceSubscriptions.lastStripeEventAt,
        dunningStartedAt: workspaceSubscriptions.dunningStartedAt,
        dunningGraceUntil: workspaceSubscriptions.dunningGraceUntil,
      })
      .from(workspaceSubscriptions)
      .where(eq(workspaceSubscriptions.workspaceId, targetWorkspaceId))
      .limit(1);

    if (isOlderStripeEvent(event.created, existing[0]?.lastStripeEventAt)) {
      logEvent("warn", "billing.stale_event_ignored", {
        eventId: event.id,
        type: event.type,
        workspaceId: targetWorkspaceId,
      });
      return;
    }

    const now = new Date();

    const previousPlan =
      existing[0] && existing[0].plan !== plan ? existing[0].plan : null;
    const planChange = previousPlan
      ? { previousPlan, planChangedAt: now }
      : {};

    const pastDue = status === "past_due" || status === "unpaid";
    const graceUntil = pastDue
      ? (existing[0]?.dunningGraceUntil ?? dunningGraceUntil(now))
      : null;
    const dunningStart = pastDue
      ? (existing[0]?.dunningStartedAt ?? now)
      : null;
    const entitled =
      status === "active" ||
      status === "trialing" ||
      (pastDue && graceUntil !== null && graceUntil.getTime() > now.getTime());
    const eventAt = event.created ? new Date(event.created * 1000) : now;

    await tx
      .insert(workspaceSubscriptions)
      .values({
        workspaceId: targetWorkspaceId,
        plan,
        status,
        stripeCustomerId: customerId,
        stripeSubscriptionId: stringValue(subscription.id),
        stripePriceId,
        billingInterval: intervalFromSubscription(subscription),
        trialEndsAt: dateFromUnix(subscription.trial_end),
        currentPeriodEnd: dateFromUnix(subscription.current_period_end),
        cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
        dunningStartedAt: dunningStart,
        dunningGraceUntil: graceUntil,
        lastStripeEventAt: eventAt,
        ...planChange,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: workspaceSubscriptions.workspaceId,
        set: {
          plan,
          status,
          stripeCustomerId: customerId,
          stripeSubscriptionId: stringValue(subscription.id),
          stripePriceId,
          billingInterval: intervalFromSubscription(subscription),
          trialEndsAt: dateFromUnix(subscription.trial_end),
          currentPeriodEnd: dateFromUnix(subscription.current_period_end),
          cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
          dunningStartedAt: dunningStart,
          dunningGraceUntil: graceUntil,
          lastStripeEventAt: eventAt,
          ...planChange,
          updatedAt: now,
        },
      });

    await tx
      .update(workspaces)
      .set({ plan: entitled ? plan : "free", updatedAt: now })
      .where(eq(workspaces.id, targetWorkspaceId));

    if (entitled) {
      await tx
        .update(billingChurnFeedback)
        .set({ recoveredAt: now })
        .where(
          and(
            eq(billingChurnFeedback.workspaceId, targetWorkspaceId),
            isNull(billingChurnFeedback.recoveredAt),
          ),
        );
    }

    if (status === "canceled") canceledWorkspaceId = targetWorkspaceId;
  }).catch((error) => {
    logEvent("error", "billing.event_failed", {
      eventId: event.id,
      error: serializeError(error),
    });
    throw error;
  });

  if (canceledWorkspaceId) {
    await enqueueBillingWinback(canceledWorkspaceId);
  }
}

type InvoiceObject = {
  customer?: unknown;
  amount_due?: unknown;
  currency?: unknown;
  hosted_invoice_url?: unknown;
  next_payment_attempt?: unknown;
};

async function applyPaymentFailed(event: StripeEvent): Promise<void> {
  const invoice = event.data?.object as InvoiceObject | undefined;
  const customerId = stringValue(invoice?.customer);
  if (!customerId) {
    logEvent("warn", "billing.invoice_customer_missing", { eventId: event.id });
    return;
  }

  const amountDue =
    typeof invoice?.amount_due === "number" && Number.isFinite(invoice.amount_due)
      ? invoice.amount_due
      : 0;
  const currency = stringValue(invoice?.currency) ?? "usd";
  const invoiceUrl = stringValue(invoice?.hosted_invoice_url);
  const nextAttemptAt = dateFromUnix(invoice?.next_payment_attempt)?.toISOString();

  const dunning = await db.transaction(async (tx): Promise<{
    notice: BillingNotice;
    startedAt: Date;
    graceUntil: Date;
    first: boolean;
  } | null> => {
    const claimed = await tx
      .insert(stripeEvents)
      .values({
        id: event.id,
        type: event.type,
        eventCreatedAt: event.created ? new Date(event.created * 1000) : null,
      })
      .onConflictDoNothing()
      .returning({ id: stripeEvents.id });
    if (!claimed[0]) return null;

    const workspaceId = await workspaceIdFor({ metadata: undefined, customerId });
    if (!workspaceId) {
      logEvent("warn", "billing.workspace_missing", {
        eventId: event.id,
        customerId,
      });
      return null;
    }

    const lifetime = await tx
      .select({ workspaceId: lifetimeDeals.workspaceId })
      .from(lifetimeDeals)
      .where(
        and(
          eq(lifetimeDeals.workspaceId, workspaceId),
          eq(lifetimeDeals.status, "active"),
        ),
      )
      .limit(1);
    if (lifetime[0]) return null;

    const now = new Date();
    const existing = await tx
      .select({
        status: workspaceSubscriptions.status,
        dunningStartedAt: workspaceSubscriptions.dunningStartedAt,
        dunningGraceUntil: workspaceSubscriptions.dunningGraceUntil,
        lastStripeEventAt: workspaceSubscriptions.lastStripeEventAt,
      })
      .from(workspaceSubscriptions)
      .where(eq(workspaceSubscriptions.workspaceId, workspaceId))
      .limit(1);
    const row = existing[0];
    if (isOlderStripeEvent(event.created, row?.lastStripeEventAt)) {
      logEvent("warn", "billing.stale_event_ignored", {
        eventId: event.id,
        type: event.type,
        workspaceId,
      });
      return null;
    }

    const first =
      !row?.dunningStartedAt ||
      (row?.status !== "past_due" && row?.status !== "unpaid");
    const startedAt = first ? now : (row?.dunningStartedAt ?? now);
    const graceUntil = first
      ? dunningGraceUntil(startedAt)
      : (row?.dunningGraceUntil ?? dunningGraceUntil(startedAt));

    await tx
      .update(workspaceSubscriptions)
      .set({
        status: "past_due",
        dunningStartedAt: startedAt,
        dunningGraceUntil: graceUntil,
        lastStripeEventAt: event.created
          ? new Date(event.created * 1000)
          : now,
        updatedAt: now,
      })
      .where(eq(workspaceSubscriptions.workspaceId, workspaceId));

    return {
      startedAt,
      graceUntil,
      first,
      notice: {
        workspaceId,
        kind: "dunning_reminder",
        noticeKey: `${workspaceId}:${startedAt.toISOString()}:1`,
        stage: 1,
        invoiceUrl: invoiceUrl ?? undefined,
        amountDue,
        currency,
        nextAttemptAt,
        graceEndsAt: graceUntil.toISOString(),
      },
    };
  });

  if (!dunning?.first) return;

  const baseKey = `${dunning.notice.workspaceId}:${dunning.startedAt.toISOString()}`;
  const stages: Array<{ stage: 1 | 2 | 3; kind: BillingNotice["kind"]; at: Date }> = [
    { stage: 1, kind: "dunning_reminder", at: dunningReminderAt(dunning.startedAt, 1) },
    { stage: 2, kind: "dunning_reminder", at: dunningReminderAt(dunning.startedAt, 2) },
    { stage: 3, kind: "dunning_final", at: dunningReminderAt(dunning.startedAt, 3) },
  ];

  for (const entry of stages) {
    await enqueueJob({
      type: "send_billing_email",
      payload: {
        ...dunning.notice,
        kind: entry.kind,
        stage: entry.stage,
        noticeKey: `${baseKey}:${entry.stage}`,
      },
      runAt: entry.at,
      dedupeKey: `billing-dunning:${baseKey}:${entry.stage}`,
    }).catch((error) => {
      logEvent("error", "billing.dunning_enqueue_failed", {
        eventId: event.id,
        stage: entry.stage,
        error: serializeError(error),
      });
    });
  }

  await enqueueJob({
    type: "expire_dunning",
    payload: {
      workspaceId: dunning.notice.workspaceId,
      graceUntil: dunning.graceUntil.toISOString(),
    },
    runAt: dunning.graceUntil,
    dedupeKey: `billing-dunning-expire:${baseKey}`,
  }).catch((error) => {
    logEvent("error", "billing.dunning_expiry_enqueue_failed", {
      eventId: event.id,
      error: serializeError(error),
    });
  });
}

