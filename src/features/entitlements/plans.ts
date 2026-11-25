/**
 * Plan catalogue.
 *
 * Pure data plus pure helpers. Nothing here imports the database or reads the
 * environment: the server gate in `entitlements.ts` resolves a workspace's
 * subscription and calls these functions, which keeps the pricing rules
 * unit-testable.
 *
 * Product allowances are 1 / 5 / unlimited and board allowances are
 * 2 / 5 / unlimited. Plan ids keep their original names (`starter`, `pro`) so
 * existing subscriptions, Stripe price variables and webhooks continue to work;
 * only the `starter` display name moved to Indie. Entitlements come from
 * `workspace_subscriptions` once a workspace has a billing row; Stripe webhooks
 * are the only writer of a paid subscription, not client state.
 */

import { formatUsdAmount } from "@/lib/format";

export const PLAN_IDS = ["free", "starter", "pro", "lifetime"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/** Capabilities a plan either includes or does not. */
export const PLAN_FEATURES = [
  "publicFeedback",
  "widget",
  "api",
  "ai",
  "winback",
  "guestPosting",
  "privateBoards",
  "customBranding",
  "customDomains",
  "advancedSearch",
  "sso",
  "identityMasking",
  "hideAttribution",
] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];

/** Counted allowances. `null` means unlimited. */
export const PLAN_LIMITS = [
  "products",
  "boardsPerProduct",
  "members",
  "monthlyEmails",
  "monthlyJunoReplies",
  "monthlySurveyImpressions",
  "integrations",
] as const;
export type PlanLimit = (typeof PLAN_LIMITS)[number];

/**
 * A plan's Mira model allowlist.
 *
 * `deployment` resolves to the server's configured `AI_MODEL`; there is no
 * browser-supplied model name. Free and Indie have no AI model at all. Keeping
 * this beside the plan (rather than only checking the deployment) means a
 * downgrade cannot leave a paid model reachable.
 */
export const JUNO_DEPLOYMENT_MODEL = "deployment" as const;

export type PlanDefinition = {
  id: PlanId;
  name: string;
  description: string;
  features: Record<PlanFeature, boolean>;
  limits: Record<PlanLimit, number | null>;
  /** Authenticated REST/MCP requests allowed per minute, per token. */
  apiRequestsPerMinute: number;
  junoModels: readonly string[];
};

const BASE_FEATURES: Record<PlanFeature, boolean> = {
  publicFeedback: true,
  widget: true,
  api: false,
  ai: false,
  winback: true,
  guestPosting: false,
  privateBoards: false,
  customBranding: false,
  customDomains: false,
  advancedSearch: false,
  sso: false,
  identityMasking: false,
  hideAttribution: false,
};

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: "free",
    name: "Free",
    description: "One product, two boards and the full public customer loop.",
    features: {
      ...BASE_FEATURES,
    },
    limits: {
      products: 1,
      boardsPerProduct: 2,
      members: 3,
      monthlyEmails: 500,
      monthlyJunoReplies: null,
      monthlySurveyImpressions: 500,
      integrations: 1,
    },
    apiRequestsPerMinute: 60,
    junoModels: [],
  },
  starter: {
    id: "starter",
    name: "Indie",
    description: "Five products, five boards each, guest posting, private boards and your own branding.",
    features: {
      ...BASE_FEATURES,
      guestPosting: true,
      privateBoards: true,
      customBranding: true,
      customDomains: true,
      hideAttribution: true,
    },
    limits: {
      products: 5,
      boardsPerProduct: 5,
      members: 10,
      monthlyEmails: 5_000,
      monthlyJunoReplies: null,
      monthlySurveyImpressions: null,
      integrations: 1,
    },
    apiRequestsPerMinute: 120,
    junoModels: [],
  },
  pro: {
    id: "pro",
    name: "Professional",
    description: "Unlimited products, boards and integrations, advanced search, API, Mira, SSO and masking.",
    features: {
      ...BASE_FEATURES,
      api: true,
      ai: true,
      guestPosting: true,
      privateBoards: true,
      customBranding: true,
      customDomains: true,
      advancedSearch: true,
      sso: true,
      identityMasking: true,
      hideAttribution: true,
    },
    limits: {
      products: null,
      boardsPerProduct: null,
      members: 25,
      monthlyEmails: 20_000,
      monthlyJunoReplies: null,
      monthlySurveyImpressions: null,
      integrations: null,
    },
    apiRequestsPerMinute: 600,
    junoModels: [JUNO_DEPLOYMENT_MODEL],
  },
  /**
   * Founding Lifetime: one payment, no renewal.
   *
   * It is intentionally not a fourth pricing card (`PLAN_ORDER` excludes it).
   * The metered Mira allowance is the cost boundary that makes a one-time
   * payment safe; SSO and identity masking are excluded because they are
   * ongoing integration commitments, not one-off build cost.
   */
  lifetime: {
    id: "lifetime",
    name: "Founding Lifetime",
    description:
      "Pay once: unlimited products, boards and integrations, the API, 15 teammates, 5,000 emails and 150 Mira replies a month.",
    features: {
      ...BASE_FEATURES,
      api: true,
      ai: true,
      guestPosting: true,
      privateBoards: true,
      customBranding: true,
      customDomains: true,
      advancedSearch: true,
      hideAttribution: true,
      sso: false,
      identityMasking: false,
    },
    limits: {
      products: null,
      boardsPerProduct: null,
      members: 15,
      monthlyEmails: 5_000,
      monthlyJunoReplies: 150,
      monthlySurveyImpressions: null,
      integrations: null,
    },
    apiRequestsPerMinute: 300,
    junoModels: [JUNO_DEPLOYMENT_MODEL],
  },
};

/** The plan every workspace starts on and falls back to. */
export const DEFAULT_PLAN: PlanId = "free";

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value);
}

/** Resolve an unknown database value to a real plan rather than throwing. */
export function toPlanId(value: unknown): PlanId {
  return isPlanId(value) ? value : DEFAULT_PLAN;
}

export function planDefinition(plan: PlanId): PlanDefinition {
  return PLANS[plan];
}

export function hasFeature(plan: PlanId, feature: PlanFeature): boolean {
  return PLANS[plan].features[feature];
}

/** `null` means the plan has no cap on this resource. */
export function planLimit(plan: PlanId, limit: PlanLimit): number | null {
  return PLANS[plan].limits[limit];
}

/**
 * Per-token request allowance for the REST API and MCP endpoint.
 *
 * The value is a catalogue property, not a deployment constant: an upgrade
 * applies on the next request and a downgrade immediately reduces the bucket
 * limit. Existing counters stay in place and are clamped by the new limit.
 */
export function apiRequestsPerMinute(plan: PlanId): number {
  return PLANS[plan].apiRequestsPerMinute;
}

/** The concrete models a plan may use, resolving `deployment` to `AI_MODEL`. */
export function junoModelAllowlist(
  plan: PlanId,
  deploymentModel: string | null,
): string[] {
  if (!PLANS[plan].features.ai) return [];
  const models = new Set<string>();
  for (const entry of PLANS[plan].junoModels) {
    if (entry === JUNO_DEPLOYMENT_MODEL) {
      if (deploymentModel) models.add(deploymentModel);
    } else {
      models.add(entry);
    }
  }
  return [...models];
}

/**
 * Would this plan allow the selected model?
 *
 * A blank selection means "use the deployment model" and is allowed on an
 * AI-enabled plan; the runtime still refuses to generate without one. A named
 * selection must resolve to an entry in the plan's allowlist.
 */
export function isJunoModelAllowed(
  plan: PlanId,
  deploymentModel: string | null,
  selectedModel: string | null,
): boolean {
  if (!PLANS[plan].features.ai) return false;
  if (selectedModel === null || selectedModel.trim() === "") return true;
  return junoModelAllowlist(plan, deploymentModel).includes(selectedModel.trim());
}

export type UsageCheck = {
  allowed: boolean;
  limit: number | null;
  current: number;
  remaining: number | null;
};

/**
 * Would `current + increment` stay inside the plan's limit?
 *
 * Unlimited plans always allow. The check is deliberately inclusive of zero:
 * a current count equal to the limit does not allow one more.
 */
export function checkUsage(
  plan: PlanId,
  limit: PlanLimit,
  current: number,
  increment = 1,
): UsageCheck {
  const cap = planLimit(plan, limit);
  const safeCurrent = Number.isFinite(current) ? Math.max(0, Math.trunc(current)) : 0;
  const safeIncrement = Number.isFinite(increment) ? Math.max(1, Math.trunc(increment)) : 1;

  if (cap === null) {
    return { allowed: true, limit: null, current: safeCurrent, remaining: null };
  }

  const remaining = Math.max(0, cap - safeCurrent);
  return {
    allowed: safeCurrent + safeIncrement <= cap,
    limit: cap,
    current: safeCurrent,
    remaining,
  };
}

/** A stable display order for the pricing comparison. */
export const PLAN_ORDER: readonly PlanId[] = ["free", "starter", "pro"];

/**
 * Display prices for the pricing page.
 *
 * These are the numbers a visitor sees, kept in this file so plan copy,
 * allowances and price cannot drift apart. They must match the Stripe prices
 * behind `STRIPE_PRICE_STARTER` and `STRIPE_PRICE_PRO`; Checkout remains the
 * source of truth for what is charged. A price change still needs a new Stripe
 * price, a migration for existing subscribers and this object updated in the
 * same change — editing it alone would make the page lie.
 *
 * `yearlyMonthly` is the per-month rate on the annual price, not the annual
 * total, so it can sit beside the monthly figure without changing units.
 */
export type PlanPricing = {
  monthly: number;
  yearlyMonthly: number | null;
  cta: string;
  badge?: string;
  trialDays: number | null;
};

export const PLAN_PRICING: Record<PlanId, PlanPricing> = {
  free: {
    monthly: 0,
    yearlyMonthly: null,
    cta: "Start free",
    trialDays: null,
  },
  starter: {
    monthly: 19,
    yearlyMonthly: 15,
    cta: "Start 14-day trial",
    badge: "Most popular",
    trialDays: 14,
  },
  pro: {
    monthly: 39,
    yearlyMonthly: 31,
    cta: "Start 14-day trial",
    trialDays: 14,
  },
  // One-time price, recorded here so the typed catalogue stays complete. The
  // pricing cards and comparison table iterate PLAN_ORDER, which excludes it.
  lifetime: {
    monthly: 499,
    yearlyMonthly: null,
    cta: "Claim a founding seat",
    trialDays: null,
  },
};

/** Labels for the tick/cross rows on a plan card. */
export const PLAN_FEATURE_ROWS: readonly { label: string; feature: PlanFeature }[] = [
  { label: "API access", feature: "api" },
  { label: "Mira AI replies", feature: "ai" },
  { label: "Advanced search", feature: "advancedSearch" },
  { label: "SSO and identity masking", feature: "sso" },
  { label: "Guest posting and private boards", feature: "guestPosting" },
  { label: "Custom branding and domain", feature: "customDomains" },
  { label: "Hide the Herald attribution", feature: "hideAttribution" },
] as const;

/**
 * Where each capability is actually enforced on the server.
 *
 * The catalogue is the product promise; this table is the audit trail that
 * connects a promise to a gate. `tests/plan-gates.test.ts` requires one row per
 * feature and checks the resolved matrix for every plan, so a new feature cannot
 * ship without a named enforcement point.
 */
export type PlanGate = {
  feature: PlanFeature;
  label: string;
  /** The server module/function that must reject an unentitled request. */
  serverGate: string;
  /** Extra server-side surface covered by the same gate, when relevant. */
  alsoEnforcedAt?: string;
};

export const PLAN_GATE_MATRIX: readonly PlanGate[] = [
  {
    feature: "publicFeedback",
    label: "Public feedback surface",
    serverGate: "publicSurfaceEnabled() in features/entitlements/entitlements.ts",
  },
  {
    feature: "widget",
    label: "Embeddable widget",
    serverGate: "widgetSurfaceEnabled() in features/entitlements/entitlements.ts",
  },
  {
    feature: "api",
    label: "REST API and tokens",
    serverGate: "authenticateApiRequest() in features/api-v1/auth.ts",
    alsoEnforcedAt: "createApiTokenAction() in features/workspace-settings/actions.ts",
  },
  {
    feature: "ai",
    label: "Mira AI replies",
    serverGate: "junoModelAllowlist()/isJunoModelAllowed() in features/entitlements/plans.ts",
    alsoEnforcedAt: "Mira answer and draft actions",
  },
  {
    feature: "winback",
    label: "Win-back campaigns",
    serverGate: "featureAllowed() in features/winback/actions.ts",
  },
  {
    feature: "guestPosting",
    label: "Guest posting",
    serverGate: "featureFailure() in features/boards/actions.ts",
    alsoEnforcedAt: "public board resolver in features/public/resolver.ts",
  },
  {
    feature: "privateBoards",
    label: "Private boards",
    serverGate: "featureFailure() in features/boards/actions.ts",
  },
  {
    feature: "customBranding",
    label: "Custom branding",
    serverGate: "saveBrandingAction() in features/branding/actions.ts",
  },
  {
    feature: "customDomains",
    label: "Custom domains",
    serverGate: "saveWorkspaceDomain() in features/workspace-settings/domains.ts",
  },
  {
    feature: "advancedSearch",
    label: "Advanced search",
    serverGate: "advancedSearch query gate in features/public/queries.ts",
  },
  {
    feature: "sso",
    label: "Single sign-on",
    serverGate: "checkWorkspaceFeature(..., \"sso\") in features/enterprise/actions.ts",
    alsoEnforcedAt: "SSO runtime resolution in features/customer-auth/sso.ts",
  },
  {
    feature: "identityMasking",
    label: "Identity masking",
    serverGate: "setIdentityMaskingAction() in features/workspace-settings/actions.ts",
    alsoEnforcedAt: "public projections in features/public/queries.ts",
  },
  {
    feature: "hideAttribution",
    label: "Hide the Herald attribution",
    serverGate: "saveBrandingAction() in features/branding/actions.ts",
    alsoEnforcedAt:
      "getPublicSite() branding projection and the embedded widget chrome",
  },
] as const;

export type UsageLevel = "ok" | "warning" | "limit";

/**
 * Soft-limit state for a meter or banner.
 *
 * The warning starts at 80% so an operator sees it before a hard block. An
 * unlimited allowance is always `ok`, and an over-limit counter is `limit`
 * rather than a percentage above 100.
 */
export function usageStatus(
  used: number,
  limit: number | null,
): { level: UsageLevel; percent: number } {
  const safeUsed = Number.isFinite(used) ? Math.max(0, Math.trunc(used)) : 0;
  if (limit === null) return { level: "ok", percent: 0 };
  if (limit <= 0) return { level: "limit", percent: 100 };
  const percent = Math.min(100, Math.round((safeUsed / limit) * 100));
  if (safeUsed >= limit) return { level: "limit", percent: 100 };
  if (percent >= 80) return { level: "warning", percent };
  return { level: "ok", percent };
}

/** What every plan includes, stated once rather than repeated per card. */
export const PLAN_BASE_INCLUDES =
  "Feedback, roadmap, changelog, widget, help, surveys, tours and win-back";

export function formatUsd(amount: number): string {
  return formatUsdAmount(amount);
}

/** The headline price for one plan and billing period. */
export function planDisplayAmount(plan: PlanId, billing: "monthly" | "yearly"): number {
  const price = PLAN_PRICING[plan];
  return billing === "yearly" ? (price.yearlyMonthly ?? price.monthly) : price.monthly;
}

/** e.g. "$0 free · $19 Indie · $39 Professional a month". */
export function planPriceSentence(): string {
  return PLAN_ORDER.map((plan) => {
    const definition = PLANS[plan];
    return `${formatUsd(PLAN_PRICING[plan].monthly)} ${definition.name}`;
  }).join(" · ") + " a month";
}

/**
 * Competitive benchmark recorded before any price or limit change.
 *
 * This is the answer to "how do our limits compare?", kept next to the rules
 * that enforce them rather than on a marketing page. Featurebase figures were
 * read from https://www.featurebase.app/pricing on 2026-11-07; they are a
 * snapshot, not a live import. Herald's side is derived from `PLANS` so a limit
 * change cannot leave this comparison stale.
 *
 * Featurebase prices are annual per full seat, with the monthly price in
 * parentheses. Its paid plans include a 10-day trial and charge $0.29 per AI
 * resolution; Copilot includes 10 conversations per seat/month, then $19 per
 * seat/month for unlimited use. Herald has no metered AI or export cap in the
 * plan catalogue.
 */
export const FEATUREBASE_BENCHMARK = {
  source: "https://www.featurebase.app/pricing",
  checkedAt: "2026-11-07",
  currency: "USD",
  plans: {
    free: {
      pricePerSeatAnnual: 0,
      pricePerSeatMonthly: 0,
      boards: 1,
      roadmaps: 1,
      fullSeats: 1,
      liteSeats: 0,
      ai: "Not supported",
      exports: "Not included",
      trialDays: null,
    },
    growth: {
      pricePerSeatAnnual: 29,
      pricePerSeatMonthly: 37,
      boards: 5,
      roadmaps: 5,
      fullSeats: null,
      liteSeats: 0,
      ai: "10 Copilot conversations per seat/month, then $19/seat/month; $0.29 per AI resolution",
      exports: "Paid feature, no numeric cap published",
      trialDays: 10,
    },
    professional: {
      pricePerSeatAnnual: 59,
      pricePerSeatMonthly: 75,
      boards: 10,
      roadmaps: 10,
      fullSeats: null,
      liteSeats: 20,
      ai: "10 Copilot conversations per seat/month, then $19/seat/month; $0.29 per AI resolution",
      exports: "Paid feature, no numeric cap published",
      trialDays: 10,
    },
    enterprise: {
      pricePerSeatAnnual: 99,
      pricePerSeatMonthly: 129,
      boards: null,
      roadmaps: null,
      fullSeats: null,
      liteSeats: 50,
      ai: "10 Copilot conversations per seat/month, then $19/seat/month; $0.29 per AI resolution",
      exports: "Paid feature, no numeric cap published",
      trialDays: 10,
    },
  },
  herald: {
    free: {
      products: PLANS.free.limits.products,
      boardsPerProduct: PLANS.free.limits.boardsPerProduct,
      paidMembers: PLANS.free.limits.members,
      viewerSeats: "free and uncounted",
      ai: PLANS.free.features.ai ? "Included" : "Not included",
      surveyImpressions: PLANS.free.limits.monthlySurveyImpressions,
      exports: "No numeric cap; scheduled emails count toward monthlyEmails",
      trialDays: null,
    },
    starter: {
      products: PLANS.starter.limits.products,
      boardsPerProduct: PLANS.starter.limits.boardsPerProduct,
      paidMembers: PLANS.starter.limits.members,
      viewerSeats: "free and uncounted",
      ai: PLANS.starter.features.ai ? "Included" : "Not included",
      surveyImpressions: PLANS.starter.limits.monthlySurveyImpressions,
      exports: "No numeric cap; scheduled emails count toward monthlyEmails",
      trialDays: null,
    },
    pro: {
      products: PLANS.pro.limits.products,
      boardsPerProduct: PLANS.pro.limits.boardsPerProduct,
      paidMembers: PLANS.pro.limits.members,
      viewerSeats: "free and uncounted",
      ai: PLANS.pro.features.ai ? "Included without a metered cap" : "Not included",
      surveyImpressions: PLANS.pro.limits.monthlySurveyImpressions,
      exports: "No numeric cap; scheduled emails count toward monthlyEmails",
      trialDays: null,
    },
  },
  differences: [
    {
      area: "Products",
      featurebase: "Boards are the unit; no separate product allowance is published",
      herald:
        "1 product free, 5 Indie, unlimited Professional; each product has its own boards, roadmap and changelog",
      reason:
        "Herald sells products, not board slots: the packaging claim is several products under one flat account, and the paid allowance now matches it.",
    },
    {
      area: "Boards",
      featurebase: "1 free, 5 Growth, 10 Professional, unlimited Enterprise",
      herald: "2 free, 5 Indie, unlimited Professional",
      reason:
        "Two boards on Free let a real public loop exist before paying, without matching Featurebase's one-board trial-like limit. Indie matches its Growth cap.",
    },
    {
      area: "Seats",
      featurebase: "1 free full seat; 20 Professional and 50 Enterprise Lite seats; otherwise per full seat",
      herald: "3 free paid members, 10 Indie, 25 Professional; viewers are free and uncounted",
      reason:
        "Herald optimises for a small team plus unlimited read/comment collaborators; the free viewer role is deliberately not a paid-seat lever.",
    },
    {
      area: "AI usage",
      featurebase: "Metered per seat and per resolution",
      herald: "Included on Professional with no metered cap in plans.ts",
      reason:
        "A bundled AI allowance is simpler to sell and forecast; revisit only if model cost per workspace makes the cap necessary.",
    },
    {
      area: "Exports",
      featurebase: "Paid feature with no numeric cap published",
      herald: "No numeric export cap; scheduled email exports count toward monthlyEmails",
      reason:
        "Exports are not a meaningful upsell yet; the existing monthly email allowance already bounds repeated scheduled delivery.",
    },
    {
      area: "Trial",
      featurebase: "10-day trial, no credit card",
      herald: "No trial length in plans.ts; trial state belongs to billing",
      reason:
        "Encoding a trial in the entitlement catalogue would create a second source of truth; Stripe subscription state owns dates and notices.",
    },
    {
      area: "Price",
      featurebase: "$0 / $29 / $59 / $99 annual per seat ($0 / $37 / $75 / $129 monthly)",
      herald: "Display prices live in PLAN_PRICING here; Stripe remains the source of truth for what is charged",
      reason:
        "The pricing page and plan cards read one catalogue, so a displayed price cannot drift from the plan it describes. A price change still needs a new Stripe price and a subscriber migration; editing the display value alone would make the page lie.",
    },
  ],
} as const;
