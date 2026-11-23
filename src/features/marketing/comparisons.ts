import {
  PLANS,
  PLAN_ORDER,
  PLAN_PRICING,
  formatUsd,
  planPriceSentence,
} from "@/features/entitlements/plans";

/**
 * Dated competitor snapshots.
 *
 * Every number here was read from the vendor's own pricing page on the date in
 * `checkedAt`. This is deliberately not a live import: a comparison page that
 * silently changes with a competitor's pricing experiment is worse than one
 * that says when it was checked. Re-verify before changing a figure or date.
 */

export const COMPARISON_CHECKED_AT = "2026-11-21";
export const COMPARISON_CHECKED_LABEL = "21 November 2026";

export type ComparisonSource = { label: string; url: string };

export type ComparisonVendor = {
  slug: "canny" | "featurebase" | "userjot";
  name: string;
  eyebrow: string;
  title: string;
  description: string;
  model: string;
  priceSummary: string;
  sources: ComparisonSource[];
  rows: { label: string; them: string; herald: string }[];
  chooseThem: string;
  chooseHerald: string;
};

const HERALD_PRICE = planPriceSentence();
const HERALD_YEARLY = `${formatUsd(PLAN_PRICING.starter.yearlyMonthly ?? 0)} Indie · ${formatUsd(
  PLAN_PRICING.pro.yearlyMonthly ?? 0,
)} Professional a month billed yearly`;
const HERALD_PRODUCTS = `${PLANS.free.limits.products} free · ${PLANS.starter.limits.products} Indie · unlimited Professional`;
const HERALD_BOARDS = `${PLANS.free.limits.boardsPerProduct} free · ${PLANS.starter.limits.boardsPerProduct} Indie · unlimited Professional`;
const HERALD_MEMBERS = `${PLANS.free.limits.members} free · ${PLANS.starter.limits.members} Indie · ${PLANS.pro.limits.members} Professional paid members; viewers are free`;

const HERALD = {
  price: `${HERALD_PRICE}; ${HERALD_YEARLY}. Flat per workspace, not per seat.`,
  products: HERALD_PRODUCTS,
  boards: `${HERALD_BOARDS} per product.`,
  members: HERALD_MEMBERS,
  api: "REST API and MCP server on Professional.",
  ai: "Juno AI replies on Professional.",
  roadmap: "Public feedback boards, roadmap and changelog on every plan.",
  customDomain: "Custom domain and private boards on Indie and Professional.",
  help: "Help center, surveys, tours and win-back on every plan.",
  trial: `${PLAN_PRICING.starter.trialDays}-day trial on paid plans, no credit card.`,
};

export const COMPARISON_VENDORS: readonly ComparisonVendor[] = [
  {
    slug: "canny",
    name: "Canny",
    eyebrow: "Canny alternative",
    title: "Herald vs Canny, compared on published pricing",
    description:
      "Canny bills by tracked users: the people who submit requests, vote or comment. Herald bills flat per workspace and prices products, not people. Here is the packaging side by side, with the date we checked it.",
    model: "Tracked users",
    priceSummary: "Free for 25 tracked users · Pro from $79/mo billed yearly",
    sources: [
      { label: "Canny pricing", url: "https://canny.io/pricing" },
      {
        label: "Canny product changelog",
        url: "https://canny.io/features/product-changelog",
      },
      {
        label: "Canny billing plans (help center)",
        url: "https://help.canny.io/en/articles/9131812-canny-s-billing-plans",
      },
    ],
    rows: [
      {
        label: "Published price",
        them: "$0 Free · Pro from $79/mo billed yearly ($99 monthly) · Business custom",
        herald: HERALD.price,
      },
      {
        label: "What the price scales with",
        them: "Tracked users: 25 free, 100+ Pro, 5,000+ Business. A tracked user is anyone who submits a request, votes or comments.",
        herald: `Products: ${HERALD.products}. No tracked-user limit.`,
      },
      {
        label: "Managers and contributors",
        them: "5 managers free, 10 Pro, custom Business; contributors unlimited",
        herald: HERALD.members,
      },
      {
        label: "Feedback, roadmap and changelog",
        them: "Unlimited feedback and boards on every plan; public roadmap and changelog",
        herald: HERALD.roadmap,
      },
      {
        label: "AI",
        them: "Autopilot feedback capture, deduplication and triage included on every plan",
        herald: HERALD.ai,
      },
      {
        label: "Changelog email notifications",
        them: "Pro and above",
        herald: "Included on every plan",
      },
    ],
    chooseThem:
      "Canny is the stronger fit if the number of customers giving feedback is the number you want your bill to track, or if tracked-user revenue reporting and Autopilot across support and sales conversations are the core job.",
    chooseHerald:
      "Herald is the stronger fit if you run several products and want one flat workspace bill, with each product keeping its own boards, roadmap and changelog. Herald does not price by tracked users, and this page does not claim Canny's revenue-reporting features.",
  },
  {
    slug: "featurebase",
    name: "Featurebase",
    eyebrow: "Featurebase alternative",
    title: "Herald vs Featurebase, compared on published pricing",
    description:
      "Featurebase prices each full teammate seat and bundles a support suite. Herald prices the workspace flat and keeps the product loop separate from a helpdesk. The published packaging is below.",
    model: "Per full seat",
    priceSummary: "Free for 1 seat · Growth $29/seat/mo billed yearly",
    sources: [
      { label: "Featurebase pricing", url: "https://www.featurebase.app/pricing" },
      {
        label: "Featurebase pricing explained (help center)",
        url: "https://help.featurebase.app/en/articles/7608294-featurebase-pricing-explained",
      },
    ],
    rows: [
      {
        label: "Published price",
        them: "$0 Free · $29 Growth · $59 Professional · $99 Enterprise per full seat/month billed yearly. Monthly: $37 / $75 / $129.",
        herald: HERALD.price,
      },
      {
        label: "Billing unit",
        them: "Full seats. Free includes 1 seat; Professional includes 20 Lite seats and Enterprise 50.",
        herald: `Paid members: ${HERALD.members}.`,
      },
      {
        label: "Boards and roadmaps",
        them: "1 free, 5 Growth, 10 Professional, unlimited Enterprise (recorded 7 November 2026)",
        herald: `${HERALD.boards} Each product has its own roadmap.`,
      },
      {
        label: "Help and engagement",
        them: "Live chat, inbox and ticketing, unlimited conversations and Help Center, including Free",
        herald: HERALD.help,
      },
      {
        label: "AI",
        them: "Fibi AI agent on paid plans, $0.49 per resolution",
        herald: HERALD.ai,
      },
      {
        label: "API, MCP and webhooks",
        them: "Growth and above",
        herald: HERALD.api,
      },
      {
        label: "Trial",
        them: "10-day trial, no card",
        herald: HERALD.trial,
      },
    ],
    chooseThem:
      "Featurebase is the stronger fit if you want live chat, an inbox and ticketing in the same per-seat subscription as feedback, and you are happy for the bill to grow with every teammate who needs full access.",
    chooseHerald:
      "Herald is the stronger fit if you want a flat workspace price, several products on one account, and a public feedback, roadmap, changelog and win-back loop without buying a helpdesk seat for every teammate.",
  },
  {
    slug: "userjot",
    name: "UserJot",
    eyebrow: "UserJot alternative",
    title: "Herald vs UserJot, compared on published pricing",
    description:
      "UserJot is the closest product to Herald: flat workspace pricing, unlimited end users and a public roadmap and changelog. The real differences are product count, API access and the request brief.",
    model: "Flat per workspace",
    priceSummary: "Free · Starter $29/mo · Professional $59/mo",
    sources: [{ label: "UserJot pricing", url: "https://userjot.com/pricing" }],
    rows: [
      {
        label: "Published price",
        them: "$0 Free · $29 Starter · $59 Professional a month, flat per workspace",
        herald: HERALD.price,
      },
      {
        label: "End users and requests",
        them: "Unlimited on every plan",
        herald: "No tracked-user or request cap published. Paid members are capped; viewers are free.",
      },
      {
        label: "Feedback boards",
        them: "2 free · 5 Starter · unlimited Professional",
        herald: `${HERALD_BOARDS} per product.`,
      },
      {
        label: "Products under one account",
        them: "Boards are the paid unit; no separate product allowance published",
        herald: HERALD.products,
      },
      {
        label: "Public roadmap and changelog",
        them: "Every plan",
        herald: "Every plan",
      },
      {
        label: "REST API and MCP server",
        them: "Every plan, including Free",
        herald: HERALD.api,
      },
      {
        label: "Custom domain and private boards",
        them: "Starter and Professional",
        herald: HERALD.customDomain,
      },
      {
        label: "AI",
        them: "Live chat and Juno are in beta and not part of plan pricing",
        herald: HERALD.ai,
      },
      {
        label: "Trial",
        them: "14-day trial on Starter and Professional",
        herald: HERALD.trial,
      },
    ],
    chooseThem:
      "UserJot is the better choice if you run one product and want REST API and MCP access on a $29 plan. Its free tier is generous, and its feature set is close to Herald's.",
    chooseHerald:
      "Herald is the better choice if you run several products under one account: Indie is $19 for five products, each with its own boards, roadmap and changelog, and the request detail produces a Markdown brief an agent can start from. API and MCP access need Professional at $39.",
  },
] as const;

export function getComparisonVendor(slug: string): ComparisonVendor | undefined {
  return COMPARISON_VENDORS.find((vendor) => vendor.slug === slug);
}

export function heraldPlanSummary(): string {
  return PLAN_ORDER.map((planId) => {
    const plan = PLANS[planId];
    const price = PLAN_PRICING[planId];
    return `${plan.name} ${formatUsd(price.monthly)}/mo${price.yearlyMonthly === null ? "" : ` (${formatUsd(price.yearlyMonthly)} yearly)`}`;
  }).join(" · ");
}
