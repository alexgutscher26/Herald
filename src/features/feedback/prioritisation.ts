import type {
  CustomerRevenue,
  FeedbackPost,
  PrioritySignals,
} from "@/types";

/**
 * Prioritisation signals, computed and never invented.
 *
 * Inputs are the team's stored 1–5 judgements (`feedback_prioritisation`), the
 * people already attached to the request (author, voters, commenters and
 * followers) and the revenue stored for their companies. Revenue comes from an
 * ARR or annualised MRR trait, then from the CRM's annual-revenue cache, and
 * finally from an open CRM deal value — each converted to dollars, never
 * parsed from a string. When none is stored the value is `null` and the UI
 * shows "—", never a zero that would look like a real measurement.
 *
 * `requesterWeight` gives every distinct requester one unit and adds one unit
 * per whole `REVENUE_WEIGHT_UNIT` of known revenue, so a request from a large
 * account can outrank one with more small requesters without hiding either
 * fact. `priorityScore` turns that into one sortable number:
 *
 *     priorityScore = impact ÷ effort × demand
 *
 * where demand is the requester weight with a floor of 1. The formula is
 * exported and shown in the UI, not buried here. Business value stays a
 * separate lens (`valuePerEffort`) rather than being averaged into impact.
 */

export const PRIORITISATION_SCALE = 5;
export const REVENUE_WEIGHT_UNIT = 10_000;

/**
 * A request at or above this score with no release linked is "unmet demand".
 * It is a report threshold, not a ranking rule; the UI states the number.
 */
export const TOP_UNMET_MIN_SCORE = 4;

export type PrioritisationSort =
  | "priority"
  | "impact"
  | "value_effort"
  | "requester_weight"
  | "revenue";

export type PriorityInputs = {
  impact: number | null;
  businessValue: number | null;
  effort: number | null;
  requesterCount: number;
  /** Annual revenue in dollars: ARR/MRR trait or CRM annual revenue. */
  knownArr: number | null;
  /** Open CRM deal value in dollars; null when the CRM stored none. */
  knownOpenDealValue?: number | null;
  /**
   * Revenue the requester weight uses, already summed per company. Defaults to
   * `knownArr` so callers with only one revenue number stay correct.
   */
  knownWeightBasis?: number | null;
};

/** Narrow a stored or submitted number to the 1–5 scale, else null. */
export function normalizeScaleValue(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  return rounded >= 1 && rounded <= PRIORITISATION_SCALE ? rounded : null;
}

function normalizeMoney(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

/**
 * `businessValue / effort`, rounded to two decimals.
 *
 * Both inputs are on the same 1–5 scale, so 4 ÷ 2 reads as "twice the value
 * per unit of effort". Null until both are stored.
 */
export function valuePerEffort(
  businessValue: number | null,
  effort: number | null,
): number | null {
  if (businessValue === null || effort === null || effort === 0) return null;
  return Math.round((businessValue / effort) * 100) / 100;
}

/** One unit per requester plus one per whole revenue unit of known revenue. */
export function requesterWeight(
  requesterCount: number,
  knownRevenue: number | null,
): number {
  const base = Math.max(0, Math.round(requesterCount));
  if (knownRevenue === null || knownRevenue <= 0) return base;
  return base + Math.floor(knownRevenue / REVENUE_WEIGHT_UNIT);
}

/**
 * Impact per unit of effort, multiplied by verified demand.
 *
 * Null until both the team's impact and effort judgements exist: a missing
 * input is unknown, not zero. Demand is the requester weight with a floor of
 * one, so a request with no identified customer still has a finite score.
 */
export function computePriorityScore(
  impact: number | null,
  effort: number | null,
  demand: number,
): number | null {
  if (impact === null || effort === null || effort === 0) return null;
  const factor = Math.max(1, demand);
  return Math.round((impact / effort) * factor * 10) / 10;
}

export function computeSignals(input: PriorityInputs): PrioritySignals {
  const impact = normalizeScaleValue(input.impact);
  const businessValue = normalizeScaleValue(input.businessValue);
  const effort = normalizeScaleValue(input.effort);
  const requesterCount = Math.max(0, Math.round(input.requesterCount));
  const knownArr = normalizeMoney(input.knownArr);
  const knownOpenDealValue = normalizeMoney(input.knownOpenDealValue ?? null);
  const weightBasis = normalizeMoney(
    input.knownWeightBasis === undefined ? input.knownArr : input.knownWeightBasis,
  );
  const weight = requesterWeight(requesterCount, weightBasis);

  return {
    impact,
    businessValue,
    effort,
    valuePerEffort: valuePerEffort(businessValue, effort),
    requesterCount,
    knownArr,
    knownOpenDealValue,
    requesterWeight: weight,
    priorityScore: computePriorityScore(impact, effort, weight),
  };
}

/**
 * The distinct customer requesters for one request.
 *
 * Team votes are excluded by construction; callers pass only customer votes.
 * Imported vote totals have no voter identity, so they never inflate this.
 */
export function distinctRequesters(input: {
  authorCustomerId: string | null;
  customerVoteIds?: readonly (string | null)[];
  commentCustomerIds?: readonly (string | null)[];
  followerCustomerIds?: readonly (string | null)[];
}): string[] {
  const ids = new Set<string>();
  if (input.authorCustomerId) ids.add(input.authorCustomerId);
  for (const id of input.customerVoteIds ?? []) if (id) ids.add(id);
  for (const id of input.commentCustomerIds ?? []) if (id) ids.add(id);
  for (const id of input.followerCustomerIds ?? []) if (id) ids.add(id);
  return [...ids];
}

/**
 * Annual revenue recorded on a company's traits.
 *
 * Only direct numeric traits count. A string such as "$40k" is not parsed:
 * guessing its meaning would invent data the team never stored.
 */
export function companyArr(traits: Record<string, unknown> | null | undefined): number | null {
  if (!traits) return null;
  if (typeof traits.arr === "number" && Number.isFinite(traits.arr)) {
    return traits.arr;
  }
  if (typeof traits.mrr === "number" && Number.isFinite(traits.mrr)) {
    return Math.round(traits.mrr * 12 * 100) / 100;
  }
  return null;
}

function centsToDollars(cents: number | null | undefined): number | null {
  if (cents === null || cents === undefined || !Number.isFinite(cents) || cents <= 0) {
    return null;
  }
  return Math.round((cents / 100) * 100) / 100;
}

export type CompanyRevenue = {
  annualRevenue: number | null;
  openDealValue: number | null;
  /** Annual revenue when known, otherwise open deal value. */
  weightBasis: number | null;
};

/**
 * The revenue we know about one company, from the sources we actually store.
 *
 * The explicit ARR/MRR trait wins over the CRM annual-revenue cache because a
 * teammate typed it for this workspace. An open deal value is a fallback for
 * weighting only; it is displayed separately so recurring and pipeline money
 * are never added together as if they were the same thing.
 */
export function companyRevenue(input: {
  traits: Record<string, unknown> | null | undefined;
  crmAnnualRevenueCents?: number | null;
  crmOpenDealValueCents?: number | null;
}): CompanyRevenue {
  const annualRevenue =
    companyArr(input.traits) ?? centsToDollars(input.crmAnnualRevenueCents);
  const openDealValue = centsToDollars(input.crmOpenDealValueCents);

  return {
    annualRevenue,
    openDealValue,
    weightBasis: annualRevenue ?? openDealValue,
  };
}

export type KnownRevenue = {
  annualRevenue: number | null;
  openDealValue: number | null;
  weightBasis: number | null;
};

/**
 * Sum known revenue across a set of requesters, counting a shared company once.
 *
 * Returns null for a source no requester has, which is different from a known
 * total of zero. `weightBasis` sums one value per company, so a company with
 * both recurring revenue and an open deal is not counted twice.
 */
export function sumKnownRevenue(
  requesters: readonly string[],
  revenue: readonly CustomerRevenue[],
): KnownRevenue {
  const requesterSet = new Set(requesters);
  const byCompany = new Map<string, CustomerRevenue>();

  for (const entry of revenue) {
    if (!requesterSet.has(entry.customerId)) continue;
    if (!byCompany.has(entry.companyId)) byCompany.set(entry.companyId, entry);
  }

  if (byCompany.size === 0) {
    return { annualRevenue: null, openDealValue: null, weightBasis: null };
  }

  const sum = (pick: (entry: CustomerRevenue) => number | null): number | null => {
    let total = 0;
    let known = false;
    for (const entry of byCompany.values()) {
      const value = pick(entry);
      if (value === null || !Number.isFinite(value)) continue;
      total += value;
      known = true;
    }
    return known ? Math.round(total * 100) / 100 : null;
  };

  return {
    annualRevenue: sum((entry) => entry.annualRevenue),
    openDealValue: sum((entry) => entry.openDealValue),
    weightBasis: sum((entry) => entry.weightBasis),
  };
}

/** Sort descending by a signal, with unset values last in both directions. */
export function compareSignals(
  a: { signals: PrioritySignals; votes: number },
  b: { signals: PrioritySignals; votes: number },
  sort: PrioritisationSort | "votes",
): number {
  const pick = (
    entry: { signals: PrioritySignals; votes: number },
  ): number | null => {
    switch (sort) {
      case "votes":
        return entry.votes;
      case "priority":
        return entry.signals.priorityScore;
      case "impact":
        return entry.signals.impact;
      case "value_effort":
        return entry.signals.valuePerEffort;
      case "requester_weight":
        return entry.signals.requesterWeight;
      case "revenue":
        return entry.signals.knownArr;
    }
  };

  const left = pick(a);
  const right = pick(b);

  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
}

/** Sort key for the inbox's stable secondary ordering. */
export function comparePostsBySignal(
  a: FeedbackPost,
  b: FeedbackPost,
  signals: (postId: string) => PrioritySignals,
  votes: (postId: string) => number,
  sort: PrioritisationSort | "votes",
): number {
  const primary = compareSignals(
    { signals: signals(a.id), votes: votes(a.id) },
    { signals: signals(b.id), votes: votes(b.id) },
    sort,
  );
  if (primary !== 0) return primary;
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

export type UnmetDemandEntry = {
  post: FeedbackPost;
  signals: PrioritySignals;
};

/**
 * Top unmet demand: high score, no release linked, oldest first.
 *
 * Shipped, closed, merged and hidden requests are excluded: the report is
 * meant to surface demand the team has not answered, not work already done or
 * content the team removed from circulation.
 */
export function topUnmetDemand(
  entries: readonly UnmetDemandEntry[],
  limit = 8,
): UnmetDemandEntry[] {
  return [...entries]
    .filter(
      ({ post, signals }) =>
        post.releaseId === null &&
        post.mergedIntoId === null &&
        post.hiddenAt === null &&
        !post.authorBanned &&
        post.status !== "shipped" &&
        post.status !== "closed" &&
        signals.priorityScore !== null &&
        signals.priorityScore >= TOP_UNMET_MIN_SCORE,
    )
    .sort(
      (a, b) =>
        new Date(a.post.createdAt).getTime() -
        new Date(b.post.createdAt).getTime(),
    )
    .slice(0, Math.max(0, limit));
}
