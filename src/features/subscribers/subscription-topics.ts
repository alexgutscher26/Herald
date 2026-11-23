import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  subscriberTopicPreferences,
  subscriptionTopics,
  type SubscriptionTopic,
} from "@/db/schema/subscribers";
import { isUniqueViolation } from "@/lib/error-message";
import { releaseTags } from "@/db/schema/releases";

import {
  DEFAULT_SUBSCRIPTION_TOPICS,
  PRODUCT_UPDATES_TOPIC,
  WINBACK_TOPIC,
  isReleaseTagTopicKey,
  normalizeTopicKey,
  releaseTagTopicKey,
  type TopicFormValues,
} from "./topics";

/**
 * Topic storage.
 *
 * The two built-in topics are created lazily so an existing product gains them
 * without a data migration. Their delivery state stays on the subscriber row,
 * which is why every existing release and win-back query remains valid.
 */

export type SubscriptionTopicView = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  position: number;
  active: boolean;
  builtIn: boolean;
  tag: boolean;
};

function toView(row: SubscriptionTopic): SubscriptionTopicView {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    position: row.position,
    active: row.active,
    builtIn: row.key === PRODUCT_UPDATES_TOPIC || row.key === WINBACK_TOPIC,
    tag: isReleaseTagTopicKey(row.key),
  };
}

export async function ensureDefaultSubscriptionTopics(productId: string): Promise<void> {
  await db
    .insert(subscriptionTopics)
    .values(
      DEFAULT_SUBSCRIPTION_TOPICS.map((topic) => ({
        productId,
        key: topic.key,
        name: topic.name,
        description: topic.description,
        position: topic.position,
      })),
    )
    .onConflictDoNothing();
}

export async function listSubscriptionTopics(
  productId: string,
): Promise<SubscriptionTopicView[]> {
  await ensureDefaultSubscriptionTopics(productId);
  await ensureReleaseTagTopics(productId);
  const rows = await db
    .select()
    .from(subscriptionTopics)
    .where(eq(subscriptionTopics.productId, productId))
    .orderBy(asc(subscriptionTopics.position), asc(subscriptionTopics.name));
  return rows.map(toView);
}

/** Backfill a topic for every existing product tag, including older releases. */
export async function ensureReleaseTagTopics(productId: string): Promise<void> {
  const tags = await db
    .select({ name: releaseTags.name, slug: releaseTags.slug })
    .from(releaseTags)
    .where(eq(releaseTags.productId, productId));
  if (tags.length === 0) return;

  await db
    .insert(subscriptionTopics)
    .values(
      tags.map((tag, index) => ({
        productId,
        key: releaseTagTopicKey(tag.slug),
        name: `Tag: ${tag.name}`,
        description: `Updates tagged ${tag.name}.`,
        position: 100 + index,
      })),
    )
    .onConflictDoNothing();
}

export async function listActiveSubscriptionTopics(
  productId: string,
): Promise<SubscriptionTopicView[]> {
  return (await listSubscriptionTopics(productId)).filter((topic) => topic.active);
}

export async function createSubscriptionTopic(input: {
  productId: string;
  form: TopicFormValues;
}): Promise<{ ok: true; topic: SubscriptionTopicView } | { ok: false; error: string }> {
  await ensureDefaultSubscriptionTopics(input.productId);
  const name = input.form.name.trim();
  const key = normalizeTopicKey(input.form.key.trim() === "" ? name : input.form.key);
  if (key === "" || key.length < 2) {
    return { ok: false, error: "Enter a topic name with URL-safe characters." };
  }
  if (key === PRODUCT_UPDATES_TOPIC || key === WINBACK_TOPIC || isReleaseTagTopicKey(key)) {
    return { ok: false, error: "That key belongs to a built-in topic." };
  }

  try {
    const rows = await db
      .insert(subscriptionTopics)
      .values({
        productId: input.productId,
        key,
        name,
        description: input.form.description.trim() || null,
        position: input.form.position,
        active: input.form.active,
      })
      .returning();
    const row = rows[0];
    if (!row) return { ok: false, error: "Could not create that topic." };
    return { ok: true, topic: toView(row) };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: "A topic with that key already exists." };
    }
    throw error;
  }
}

export async function setSubscriptionTopicActive(input: {
  productId: string;
  topicId: string;
  active: boolean;
}): Promise<boolean> {
  const rows = await db
    .update(subscriptionTopics)
    .set({ active: input.active, updatedAt: new Date() })
    .where(
      and(
        eq(subscriptionTopics.id, input.topicId),
        eq(subscriptionTopics.productId, input.productId),
      ),
    )
    .returning({ id: subscriptionTopics.id });
  return rows.length > 0;
}

export async function deleteSubscriptionTopic(input: {
  productId: string;
  topicId: string;
}): Promise<boolean> {
  const rows = await db
    .delete(subscriptionTopics)
    .where(
      and(
        eq(subscriptionTopics.id, input.topicId),
        eq(subscriptionTopics.productId, input.productId),
        sql`${subscriptionTopics.key} NOT IN (${PRODUCT_UPDATES_TOPIC}, ${WINBACK_TOPIC}) AND ${subscriptionTopics.key} NOT LIKE 'tag\_%'`,
      ),
    )
    .returning({ id: subscriptionTopics.id });
  return rows.length > 0;
}

/** Preferences for one subscriber, keyed by topic. */
export async function loadSubscriberTopicPreferences(input: {
  productId: string;
  subscriberId: string;
}): Promise<Map<string, boolean>> {
  const rows = await db
    .select({
      key: subscriptionTopics.key,
      subscribed: subscriberTopicPreferences.subscribed,
    })
    .from(subscriberTopicPreferences)
    .innerJoin(
      subscriptionTopics,
      eq(subscriberTopicPreferences.topicId, subscriptionTopics.id),
    )
    .where(
      and(
        eq(subscriberTopicPreferences.subscriberId, input.subscriberId),
        eq(subscriberTopicPreferences.productId, input.productId),
      ),
    );
  return new Map(rows.map((row) => [row.key, row.subscribed]));
}

export async function replaceSubscriberTopicPreferences(input: {
  productId: string;
  subscriberId: string;
  preferences: Map<string, boolean>;
}): Promise<void> {
  if (input.preferences.size === 0) return;

  const topics = await db
    .select({ id: subscriptionTopics.id, key: subscriptionTopics.key })
    .from(subscriptionTopics)
    .where(eq(subscriptionTopics.productId, input.productId));
  const topicByKey = new Map(topics.map((topic) => [topic.key, topic.id]));
  const now = new Date();

  const values = [...input.preferences.entries()].flatMap(([key, subscribed]) => {
    const topicId = topicByKey.get(key);
    if (!topicId) return [];
    return [
      {
        subscriberId: input.subscriberId,
        topicId,
        productId: input.productId,
        subscribed,
        updatedAt: now,
      },
    ];
  });
  if (values.length === 0) return;

  await db
    .insert(subscriberTopicPreferences)
    .values(values)
    .onConflictDoUpdate({
      target: [
        subscriberTopicPreferences.subscriberId,
        subscriberTopicPreferences.topicId,
      ],
      set: {
        subscribed: sql`excluded.subscribed`,
        updatedAt: now,
      },
    });
}
