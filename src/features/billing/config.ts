import "server-only";

import { getServerEnv } from "@/lib/env";

/**
 * Stripe configuration.
 *
 * The secret key, webhook secret and both recurring prices are a single
 * configuration: setting only one is an operator error, not a partial feature.
 * Unset completely, billing is disabled and the settings screen explains how to
 * enable it. The one-time lifetime price is optional on top of that base: a
 * deployment can sell subscriptions before the lifetime offer is live, but a
 * lifetime price without the base keys fails closed. Prices are server-side
 * only; the browser receives a plan id, never a Stripe price or secret.
 */

export type PaidPlan = "starter" | "pro";
export type BillingInterval = "monthly" | "annual";

export type BillingConfig = {
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PRICE_STARTER: string;
  STRIPE_PRICE_PRO: string;
  /** Empty when annual checkout is not configured. */
  STRIPE_PRICE_STARTER_ANNUAL: string;
  STRIPE_PRICE_PRO_ANNUAL: string;
  /** Empty when the Founding Lifetime offer is not configured. */
  STRIPE_PRICE_LIFETIME: string;
  STRIPE_API_URL: string;
  APP_URL: string;
};

export const PLAN_PRICE_ENV: Record<PaidPlan, "STRIPE_PRICE_STARTER" | "STRIPE_PRICE_PRO"> = {
  starter: "STRIPE_PRICE_STARTER",
  pro: "STRIPE_PRICE_PRO",
};

export function getBillingConfig(): BillingConfig | null {
  const values = {
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY?.trim() ?? "",
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? "",
    STRIPE_PRICE_STARTER: process.env.STRIPE_PRICE_STARTER?.trim() ?? "",
    STRIPE_PRICE_PRO: process.env.STRIPE_PRICE_PRO?.trim() ?? "",
  };
  const lifetime = process.env.STRIPE_PRICE_LIFETIME?.trim() ?? "";
  const annual = {
    STRIPE_PRICE_STARTER_ANNUAL: process.env.STRIPE_PRICE_STARTER_ANNUAL?.trim() ?? "",
    STRIPE_PRICE_PRO_ANNUAL: process.env.STRIPE_PRICE_PRO_ANNUAL?.trim() ?? "",
  };

  const present = Object.values(values).filter((value) => value.length > 0);
  if (present.length === 0) {
    if (lifetime.length > 0) {
      throw new Error(
        "STRIPE_PRICE_LIFETIME needs STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_STARTER and STRIPE_PRICE_PRO too.",
      );
    }
    return null;
  }
  if (present.length !== Object.values(values).length) {
    throw new Error(
      "Stripe billing needs STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_STARTER and STRIPE_PRICE_PRO together.",
    );
  }

  const annualValues = Object.values(annual);
  if (annualValues.some((value) => value.length > 0) && annualValues.some((value) => value.length === 0)) {
    throw new Error(
      "Annual billing needs STRIPE_PRICE_STARTER_ANNUAL and STRIPE_PRICE_PRO_ANNUAL together.",
    );
  }

  return {
    ...values,
    ...annual,
    STRIPE_PRICE_LIFETIME: lifetime,
    STRIPE_API_URL:
      process.env.STRIPE_API_URL?.trim().replace(/\/+$/, "") || "https://api.stripe.com",
    APP_URL: getServerEnv().BETTER_AUTH_URL.replace(/\/+$/, ""),
  };
}

export function priceIdForPlan(config: BillingConfig, plan: PaidPlan): string {
  return priceIdForPlanInterval(config, plan, "monthly");
}

export function priceIdForPlanInterval(
  config: BillingConfig,
  plan: PaidPlan,
  interval: BillingInterval,
): string {
  if (interval === "annual") {
    return plan === "starter"
      ? config.STRIPE_PRICE_STARTER_ANNUAL
      : config.STRIPE_PRICE_PRO_ANNUAL;
  }
  return plan === "starter" ? config.STRIPE_PRICE_STARTER : config.STRIPE_PRICE_PRO;
}

export function annualBillingConfigured(config: BillingConfig | null): boolean {
  return Boolean(
    config?.STRIPE_PRICE_STARTER_ANNUAL && config?.STRIPE_PRICE_PRO_ANNUAL,
  );
}

export function planForPriceId(config: BillingConfig, priceId: string): PaidPlan | null {
  if (priceId === config.STRIPE_PRICE_STARTER) return "starter";
  if (priceId === config.STRIPE_PRICE_PRO) return "pro";
  if (priceId === config.STRIPE_PRICE_STARTER_ANNUAL) return "starter";
  if (priceId === config.STRIPE_PRICE_PRO_ANNUAL) return "pro";
  return null;
}

export function intervalForPriceId(
  config: BillingConfig,
  priceId: string,
): BillingInterval {
  return priceId === config.STRIPE_PRICE_STARTER_ANNUAL ||
    priceId === config.STRIPE_PRICE_PRO_ANNUAL
    ? "annual"
    : "monthly";
}
