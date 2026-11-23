import "server-only";

import { getBillingConfig } from "./config";

/**
 * Minimal Stripe REST client.
 *
 * A form-encoded HTTP call is enough for Checkout, Customer Portal and the two
 * subscription reads; adding an SDK would add a dependency and a second source
 * of types for a very small surface. Every call is server-only and time-boxed.
 */

const REQUEST_TIMEOUT_MS = 15_000;

type StripeError = { message?: string; type?: string; code?: string };

function formValue(value: unknown): string {
  return typeof value === "boolean" ? String(value) : String(value);
}

export function toFormBody(
  input: Record<string, string | number | boolean | null | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined) continue;
    params.append(key, formValue(value));
  }
  return params.toString();
}

async function stripeRequest<T>(
  path: string,
  body?: Record<string, string | number | boolean | null | undefined>,
  method: "GET" | "POST" = "POST",
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  let config;
  try {
    config = getBillingConfig();
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Billing configuration is invalid.",
    };
  }
  if (!config) return { ok: false, error: "Stripe billing is not configured." };

  try {
    const init: RequestInit = {
      method,
      headers: {
        authorization: `Bearer ${config.STRIPE_SECRET_KEY}`,
        "content-type": "application/x-www-form-urlencoded",
        "stripe-version": "2024-06-20",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };
    if (method === "POST") init.body = toFormBody(body ?? {});
    const response = await fetch(`${config.STRIPE_API_URL}${path}`, init);
    const payload = (await response.json().catch(() => null)) as
      | (T & { error?: StripeError })
      | null;

    if (!response.ok || !payload) {
      return {
        ok: false,
        error:
          payload?.error?.message ??
          `Stripe rejected the request (HTTP ${response.status}).`,
      };
    }
    return { ok: true, data: payload as T };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error && error.name === "TimeoutError"
          ? "Stripe did not respond in time."
          : "Could not reach Stripe.",
    };
  }
}

export type StripeCustomer = { id: string };

export async function createStripeCustomer(input: {
  email: string;
  name: string;
  workspaceId: string;
  invoiceFooter?: string;
}): Promise<{ ok: true; customer: StripeCustomer } | { ok: false; error: string }> {
  const result = await stripeRequest<StripeCustomer>("/v1/customers", {
    email: input.email,
    name: input.name,
    "invoice_settings[footer]": input.invoiceFooter,
    "metadata[workspace_id]": input.workspaceId,
  });
  return result.ok ? { ok: true, customer: result.data } : result;
}

/** Keep the customer name and invoice footer aligned with the workspace. */
export async function syncStripeCustomer(input: {
  customerId: string;
  name: string;
  invoiceFooter?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await stripeRequest<StripeCustomer>(
    `/v1/customers/${encodeURIComponent(input.customerId)}`,
    {
      name: input.name,
      "invoice_settings[footer]": input.invoiceFooter,
    },
  );
  return result.ok ? { ok: true } : result;
}

export type StripeCheckoutSession = { id: string; url: string | null };

export async function createStripeCheckoutSession(input: {
  customerId: string;
  priceId: string;
  plan: "starter" | "pro";
  interval: "monthly" | "annual";
  workspaceId: string;
  trialDays: number;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ ok: true; session: StripeCheckoutSession } | { ok: false; error: string }> {
  const result = await stripeRequest<StripeCheckoutSession>("/v1/checkout/sessions", {
    mode: "subscription",
    customer: input.customerId,
    "line_items[0][price]": input.priceId,
    "line_items[0][quantity]": 1,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.workspaceId,
    "metadata[workspace_id]": input.workspaceId,
    "metadata[plan]": input.plan,
    "metadata[interval]": input.interval,
    "subscription_data[trial_period_days]": input.trialDays,
    "subscription_data[metadata][workspace_id]": input.workspaceId,
    "subscription_data[metadata][plan]": input.plan,
    "subscription_data[metadata][interval]": input.interval,
    // Stripe Tax calculates VAT/GST/sales tax from the billing address and
    // the customer's tax id. The address is collected in Checkout, not trusted
    // from the browser, and the invoice is the tax document of record.
    "automatic_tax[enabled]": true,
    billing_address_collection: "required",
    "customer_update[address]": "auto",
    "customer_update[name]": "auto",
    "tax_id_collection[enabled]": true,
    allow_promotion_codes: true,
  });
  return result.ok ? { ok: true, session: result.data } : result;
}

export type StripeLifetimeCheckoutSession = { id: string; url: string | null };

/**
 * One-time Checkout for the Founding Lifetime offer.
 *
 * `mode: "payment"` is the whole point: there is no subscription object, no
 * trial and no renewal. The reservation expiry is sent as `expires_at` so a
 * Checkout that is never completed cannot hold a seat indefinitely.
 */
export async function createStripeLifetimeCheckoutSession(input: {
  customerId: string;
  priceId: string;
  workspaceId: string;
  purchaserUserId: string;
  expiresAt: Date;
  successUrl: string;
  cancelUrl: string;
  termsUrl: string;
}): Promise<
  { ok: true; session: StripeLifetimeCheckoutSession } | { ok: false; error: string }
> {
  const result = await stripeRequest<StripeLifetimeCheckoutSession>(
    "/v1/checkout/sessions",
    {
      mode: "payment",
      customer: input.customerId,
      "line_items[0][price]": input.priceId,
      "line_items[0][quantity]": 1,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.workspaceId,
      expires_at: Math.floor(input.expiresAt.getTime() / 1000),
      "metadata[offer]": "lifetime",
      "metadata[workspace_id]": input.workspaceId,
      "metadata[purchaser_user_id]": input.purchaserUserId,
      "payment_intent_data[metadata][offer]": "lifetime",
      "payment_intent_data[metadata][workspace_id]": input.workspaceId,
      "invoice_creation[enabled]": true,
      "custom_text[submit][message]": `Founding Lifetime terms (30-day refund): ${input.termsUrl}`,
    },
  );
  return result.ok ? { ok: true, session: result.data } : result;
}

/** Refund a payment intent in full; used when a paid seat can no longer grant. */
export async function refundStripePaymentIntent(
  paymentIntentId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await stripeRequest<{ id: string }>("/v1/refunds", {
    payment_intent: paymentIntentId,
  });
  return result.ok ? { ok: true } : result;
}

export type StripePortalSession = { url: string };

export async function createStripePortalSession(input: {
  customerId: string;
  returnUrl: string;
}): Promise<{ ok: true; portal: StripePortalSession } | { ok: false; error: string }> {
  const result = await stripeRequest<StripePortalSession>(
    "/v1/billing_portal/sessions",
    {
      customer: input.customerId,
      return_url: input.returnUrl,
    },
  );
  return result.ok ? { ok: true, portal: result.data } : result;
}

export type StripeSubscription = {
  id: string;
  customer: string;
  status: string;
  cancel_at_period_end?: boolean;
  trial_end?: number | null;
  current_period_end?: number | null;
  metadata?: Record<string, string> | null;
  items?: { data?: Array<{ id?: string; price?: { id?: string } }> } | null;
};

export async function retrieveStripeSubscription(
  subscriptionId: string,
): Promise<{ ok: true; subscription: StripeSubscription } | { ok: false; error: string }> {
  const result = await stripeRequest<StripeSubscription>(
    `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
  );
  return result.ok ? { ok: true, subscription: result.data } : result;
}

/** Change the single subscription item's price with a prorated credit/charge. */
export async function updateStripeSubscriptionPrice(input: {
  subscriptionId: string;
  itemId: string;
  priceId: string;
  plan: "starter" | "pro";
  interval: "monthly" | "annual";
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await stripeRequest<StripeSubscription>(
    `/v1/subscriptions/${encodeURIComponent(input.subscriptionId)}`,
    {
      "items[0][id]": input.itemId,
      "items[0][price]": input.priceId,
      proration_behavior: "create_prorations",
      "metadata[plan]": input.plan,
      "metadata[interval]": input.interval,
    },
  );
  return result.ok ? { ok: true } : result;
}

export type StripeProrationPreview = {
  amountDue: number;
  total: number;
  startingBalance: number;
  currency: string;
  nextPaymentAt: string | null;
};

/**
 * Read Stripe's upcoming invoice before a plan change.
 *
 * `backend` uses the same proration settings as the real update, so the amount
 * shown is the amount Stripe will put on the next invoice (a credit appears as
 * a negative starting balance). Nothing is written by this call.
 */
export async function previewStripeProration(input: {
  customerId: string;
  subscriptionId: string;
  itemId: string;
  priceId: string;
}): Promise<{ ok: true; preview: StripeProrationPreview } | { ok: false; error: string }> {
  const query = new URLSearchParams({
    customer: input.customerId,
    subscription: input.subscriptionId,
    "subscription_items[0][id]": input.itemId,
    "subscription_items[0][price]": input.priceId,
    subscription_proration_behavior: "create_prorations",
  });
  const result = await stripeRequest<{
    amount_due?: number;
    total?: number;
    starting_balance?: number;
    currency?: string;
    next_payment_attempt?: number | null;
  }>(`/v1/invoices/upcoming?${query.toString()}`, undefined, "GET");
  if (!result.ok) return result;

  return {
    ok: true,
    preview: {
      amountDue: typeof result.data.amount_due === "number" ? result.data.amount_due : 0,
      total: typeof result.data.total === "number" ? result.data.total : 0,
      startingBalance:
        typeof result.data.starting_balance === "number"
          ? result.data.starting_balance
          : 0,
      currency: typeof result.data.currency === "string" ? result.data.currency : "usd",
      nextPaymentAt:
        typeof result.data.next_payment_attempt === "number"
          ? new Date(result.data.next_payment_attempt * 1000).toISOString()
          : null,
    },
  };
}

/** Extend a trialing subscription's trial in Stripe; the webhook mirrors it. */
export async function extendStripeTrial(input: {
  subscriptionId: string;
  trialEnd: Date;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await stripeRequest<StripeSubscription>(
    `/v1/subscriptions/${encodeURIComponent(input.subscriptionId)}`,
    { trial_end: Math.floor(input.trialEnd.getTime() / 1000) },
  );
  return result.ok ? { ok: true } : result;
}

export type StripeInvoice = {
  id: string;
  number: string | null;
  status: string | null;
  total: number;
  currency: string;
  created: number;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
};

export async function listStripeInvoices(
  customerId: string,
  limit = 12,
): Promise<{ ok: true; invoices: StripeInvoice[] } | { ok: false; error: string }> {
  const query = new URLSearchParams({
    customer: customerId,
    limit: String(Math.min(Math.max(limit, 1), 24)),
  });
  const result = await stripeRequest<{ data?: StripeInvoice[] }>(
    `/v1/invoices?${query.toString()}`,
    undefined,
    "GET",
  );
  return result.ok
    ? { ok: true, invoices: result.data.data ?? [] }
    : result;
}
