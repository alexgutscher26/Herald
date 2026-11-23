import "server-only";

import { and, eq, gte, inArray, or } from "drizzle-orm";

import { db } from "@/db";
import { notificationDeliveries, buildDeliveryDedupeKey } from "@/db/schema/notifications";
import { releases } from "@/db/schema/releases";
import { subscribers } from "@/db/schema/subscribers";
import { products, workspaces } from "@/db/schema/workspaces";
import {
  publicSurfaceEnabled,
} from "@/features/entitlements/entitlements";
import { toPlanId } from "@/features/entitlements/plans";
import { createPreferenceToken } from "@/features/subscribers/preferences";

/**
 * Product digest queueing.
 *
 * A digest is one outbox row per opted-in, active subscriber for products that
 * published a public changelog entry in the selected window. The dedupe key
 * contains the UTC day (daily) or ISO week (weekly), so retries and overlapping
 * scheduler runs cannot send the same person two digests for one period.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const MAX_SUBSCRIBERS = 5_000;

export type DigestCadence = "daily" | "weekly";

export type DigestQueueSummary = {
  checkedAt: string;
  /** Cadence-specific key: YYYY-MM-DD for daily, Monday date for weekly. */
  sourceKey: string;
  weekKey: string;
  dayKey: string;
  /** Products that had a public release in the window. */
  products: string[];
  /** Products with opted-in subscribers but no release, so nothing was sent. */
  emptyProducts: string[];
  queued: number;
};

/** Backward-compatible alias for callers that still name the weekly digest. */
export type WeeklyDigestSummary = DigestQueueSummary & { weekKey: string };

export type DueDigestSummary = {
  checkedAt: string;
  daily: DigestQueueSummary;
  weekly: DigestQueueSummary;
};

/** Monday 00:00 UTC of the week containing `date`, formatted as YYYY-MM-DD. */
export function weeklyDigestWeekKey(date: Date): string {
  const copy = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = copy.getUTCDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  copy.setUTCDate(copy.getUTCDate() - daysSinceMonday);
  return copy.toISOString().slice(0, 10);
}

export function digestDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function enqueueDigests(
  cadence: DigestCadence,
  now: Date,
): Promise<DigestQueueSummary> {
  const sourceKey = cadence === "daily" ? digestDayKey(now) : weeklyDigestWeekKey(now);
  const weekKey = weeklyDigestWeekKey(now);
  const dayKey = digestDayKey(now);
  const since = new Date(
    now.getTime() - (cadence === "daily" ? DAY_MS : WEEK_MS),
  );

  const cadenceFilter =
    cadence === "daily"
      ? eq(subscribers.digestFrequency, "daily")
      : or(
          eq(subscribers.digestFrequency, "weekly"),
          // Compatibility with rows written before the cadence column.
          and(
            eq(subscribers.digestFrequency, "off"),
            eq(subscribers.weeklyDigest, true),
          ),
        );

  const candidates = await db
    .select({
      id: subscribers.id,
      workspaceId: products.workspaceId,
      productId: subscribers.productId,
      email: subscribers.email,
      emailNormalized: subscribers.emailNormalized,
      unsubscribeToken: subscribers.unsubscribeToken,
      plan: workspaces.plan,
    })
    .from(subscribers)
    .innerJoin(products, eq(subscribers.productId, products.id))
    .innerJoin(workspaces, eq(products.workspaceId, workspaces.id))
    .where(
      and(
        eq(subscribers.status, "active"),
        cadenceFilter,
        eq(products.publicChangelogEnabled, true),
      ),
    )
    .limit(MAX_SUBSCRIBERS);

  const eligibleCandidates = candidates.filter((row) =>
    publicSurfaceEnabled(toPlanId(row.plan)),
  );
  if (eligibleCandidates.length === 0) {
    return {
      checkedAt: now.toISOString(),
      sourceKey,
      weekKey,
      dayKey,
      products: [],
      emptyProducts: [],
      queued: 0,
    };
  }

  const productIds = [...new Set(eligibleCandidates.map((row) => row.productId))];
  const withUpdates = await db
    .selectDistinct({ productId: releases.productId })
    .from(releases)
    .where(
      and(
        inArray(releases.productId, productIds),
        eq(releases.status, "published"),
        eq(releases.channelPublicChangelog, true),
        gte(releases.publishedAt, since),
      ),
    );

  const deliverable = new Set(withUpdates.map((row) => row.productId));
  const emptyProducts = productIds.filter((productId) => !deliverable.has(productId));
  const eligible = eligibleCandidates.filter((row) => deliverable.has(row.productId));

  // A missing preference token would produce a digest with no way to opt out,
  // so every recipient gets one before the delivery is queued.
  for (const subscriber of eligible) {
    if (subscriber.unsubscribeToken) continue;
    await db
      .update(subscribers)
      .set({ unsubscribeToken: createPreferenceToken(), updatedAt: now })
      .where(eq(subscribers.id, subscriber.id));
  }

  if (eligible.length === 0) {
    return {
      checkedAt: now.toISOString(),
      sourceKey,
      weekKey,
      dayKey,
      products: [...deliverable],
      emptyProducts,
      queued: 0,
    };
  }

  const template =
    cadence === "daily" ? ("daily_digest" as const) : ("weekly_digest" as const);
  const inserted = await db
    .insert(notificationDeliveries)
    .values(
      eligible.map((subscriber) => ({
        workspaceId: subscriber.workspaceId,
        productId: subscriber.productId,
        template,
        recipientEmail: subscriber.email,
        recipientEmailNormalized: subscriber.emailNormalized,
        status: "pending" as const,
        dedupeKey: buildDeliveryDedupeKey({
          template,
          productId: subscriber.productId,
          recipientEmailNormalized: subscriber.emailNormalized,
          sourceId: sourceKey,
        }),
      })),
    )
    .onConflictDoNothing()
    .returning({ id: notificationDeliveries.id });

  return {
    checkedAt: now.toISOString(),
    sourceKey,
    weekKey,
    dayKey,
    products: [...deliverable],
    emptyProducts,
    queued: inserted.length,
  };
}

export async function enqueueWeeklyDigests(
  options: { now?: Date } = {},
): Promise<DigestQueueSummary> {
  return enqueueDigests("weekly", options.now ?? new Date());
}

export async function enqueueDailyDigests(
  options: { now?: Date } = {},
): Promise<DigestQueueSummary> {
  return enqueueDigests("daily", options.now ?? new Date());
}

/**
 * Queue both cadences. The weekly query is idempotent for the whole ISO week,
 * and the daily query for the UTC day, so a daily scheduler can call this.
 */
export async function enqueueDueDigests(
  options: { now?: Date } = {},
): Promise<DueDigestSummary> {
  const now = options.now ?? new Date();
  const [daily, weekly] = await Promise.all([
    enqueueDailyDigests({ now }),
    enqueueWeeklyDigests({ now }),
  ]);
  return { checkedAt: now.toISOString(), daily, weekly };
}
