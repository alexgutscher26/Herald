import "server-only";

import { and, asc, desc, eq, gte, isNull } from "drizzle-orm";

import { db } from "@/db";
import { customerEvents } from "@/db/schema/events";
import { customers } from "@/db/schema/customers";
import { outboundMessages } from "@/db/schema/engagement";
import { segments, type Segment, type SegmentRule } from "@/db/schema/segments";
import { winbackCampaigns } from "@/db/schema/winback";
import { isUniqueViolation } from "@/lib/error-message";

import {
  activityKey,
  activityWindowDays,
  matchesSegment,
  parseSegmentRules,
  type SegmentCustomer,
} from "./rules";

/**
 * Saved audience evaluation.
 *
 * Segments are product-scoped but evaluate workspace customers, because a
 * public customer belongs to the workspace, not to one product. Activity is
 * read from product events, so an event on another product never qualifies.
 */

export type SegmentSummary = {
  id: string;
  name: string;
  description: string | null;
  rules: SegmentRule[];
  count: number;
  createdAt: string;
};

const CUSTOMER_LIMIT = 5_000;
const EVENT_LIMIT = 20_000;

type SegmentAudience = {
  customerIds: Set<string>;
  emails: Set<string>;
};

async function loadEvaluationContext(input: {
  workspaceId: string;
  productId: string;
  rules: readonly SegmentRule[];
}): Promise<{ customers: SegmentCustomer[]; activity: Set<string> }> {
  const customerRows = await db
    .select({
      id: customers.id,
      emailNormalized: customers.emailNormalized,
      traits: customers.traits,
    })
    .from(customers)
    .where(
      and(eq(customers.workspaceId, input.workspaceId), isNull(customers.bannedAt)),
    )
    .limit(CUSTOMER_LIMIT);

  const windowDays = activityWindowDays(input.rules);
  const activity = new Set<string>();
  if (windowDays > 0) {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const eventRows = await db
      .select({ customerId: customerEvents.customerId, name: customerEvents.name })
      .from(customerEvents)
      .where(
        and(
          eq(customerEvents.productId, input.productId),
          gte(customerEvents.occurredAt, since),
        ),
      )
      .limit(EVENT_LIMIT);
    for (const row of eventRows) {
      activity.add(activityKey(row.customerId, row.name));
    }
  }

  return {
    customers: customerRows.map((row) => ({
      id: row.id,
      emailNormalized: row.emailNormalized,
      traits: row.traits ?? {},
    })),
    activity,
  };
}

async function evaluateRules(input: {
  workspaceId: string;
  productId: string;
  rules: readonly SegmentRule[];
}): Promise<SegmentAudience> {
  const empty: SegmentAudience = { customerIds: new Set(), emails: new Set() };
  if (input.rules.length === 0) return empty;

  const { customers: rows, activity } = await loadEvaluationContext(input);
  const customerIds = new Set<string>();
  const emails = new Set<string>();

  for (const customer of rows) {
    if (!matchesSegment(input.rules, { customer, activity })) continue;
    customerIds.add(customer.id);
    if (customer.emailNormalized) emails.add(customer.emailNormalized);
  }

  return { customerIds, emails };
}

export async function evaluateSegment(input: {
  workspaceId: string;
  productId: string;
  rules: readonly SegmentRule[];
}): Promise<SegmentAudience> {
  return evaluateRules(input);
}

export async function evaluateSegmentById(input: {
  workspaceId: string;
  productId: string;
  segmentId: string;
}): Promise<SegmentAudience | null> {
  const segment = await getSegmentForProduct(input);
  if (!segment) return null;
  return evaluateRules({
    workspaceId: input.workspaceId,
    productId: input.productId,
    rules: segment.rules,
  });
}

export async function getSegmentForProduct(input: {
  workspaceId: string;
  productId: string;
  segmentId: string;
}): Promise<Segment | null> {
  const rows = await db
    .select()
    .from(segments)
    .where(
      and(
        eq(segments.id, input.segmentId),
        eq(segments.productId, input.productId),
        eq(segments.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listSegments(input: {
  workspaceId: string;
  productId: string;
}): Promise<SegmentSummary[]> {
  const rows = await db
    .select()
    .from(segments)
    .where(eq(segments.productId, input.productId))
    .orderBy(desc(segments.createdAt))
    .limit(100);

  const { customers: customerRows, activity } = await loadEvaluationContext({
    workspaceId: input.workspaceId,
    productId: input.productId,
    rules: rows.flatMap((row) => row.rules),
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    rules: row.rules,
    count: customerRows.filter((customer) =>
      matchesSegment(row.rules, { customer, activity }),
    ).length,
    createdAt: row.createdAt.toISOString(),
  }));
}

export type SegmentOption = { id: string; name: string };

/** Lightweight list for an outbound or win-back select control. */
export async function listSegmentOptions(productId: string): Promise<SegmentOption[]> {
  return db
    .select({ id: segments.id, name: segments.name })
    .from(segments)
    .where(eq(segments.productId, productId))
    .orderBy(asc(segments.name))
    .limit(200);
}

export type CreateSegmentResult =
  | { ok: true; segmentId: string }
  | { ok: false; error: string };

export async function createSegment(input: {
  workspaceId: string;
  productId: string;
  name: string;
  description: string;
  rules: unknown;
  createdBy: string | null;
}): Promise<CreateSegmentResult> {
  const name = input.name.trim().slice(0, 120);
  if (name.length < 2) return { ok: false, error: "Name the segment." };

  const rules = parseSegmentRules(input.rules);
  if (rules.length === 0) {
    return { ok: false, error: "Add at least one trait, plan or activity rule." };
  }

  try {
    const inserted = await db
      .insert(segments)
      .values({
        workspaceId: input.workspaceId,
        productId: input.productId,
        name,
        description: input.description.trim().slice(0, 500) || null,
        rules,
        createdBy: input.createdBy,
      })
      .returning({ id: segments.id });
    const segmentId = inserted[0]?.id;
    return segmentId
      ? { ok: true, segmentId }
      : { ok: false, error: "Could not save the segment." };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: "A segment with that name already exists." };
    }
    throw error;
  }
}

export type DeleteSegmentResult = { ok: true } | { ok: false; error: string };

/**
 * Deleting a used segment is refused. The foreign key would null the reference
 * and silently widen a scheduled message or an unfinished campaign to its
 * rules-only audience, which is not a safe default for a send.
 */
export async function deleteSegment(input: {
  workspaceId: string;
  productId: string;
  segmentId: string;
}): Promise<DeleteSegmentResult> {
  const [usedByMessage, usedByCampaign] = await Promise.all([
    db
      .select({ id: outboundMessages.id })
      .from(outboundMessages)
      .where(eq(outboundMessages.segmentId, input.segmentId))
      .limit(1),
    db
      .select({ id: winbackCampaigns.id })
      .from(winbackCampaigns)
      .where(eq(winbackCampaigns.segmentId, input.segmentId))
      .limit(1),
  ]);
  if (usedByMessage[0] || usedByCampaign[0]) {
    return {
      ok: false,
      error: "That segment is used by an outbound message or campaign. Remove it there first.",
    };
  }

  const removed = await db
    .delete(segments)
    .where(
      and(
        eq(segments.id, input.segmentId),
        eq(segments.productId, input.productId),
        eq(segments.workspaceId, input.workspaceId),
      ),
    )
    .returning({ id: segments.id });
  return removed.length > 0
    ? { ok: true }
    : { ok: false, error: "That segment no longer exists." };
}
