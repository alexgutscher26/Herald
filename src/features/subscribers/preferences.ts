import "server-only";

import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { customerAccounts } from "@/db/schema/winback";
import { products, subscribers, workspaces } from "@/db/schema";
import { normalizeEmail } from "@/lib/email";

import {
  effectiveDigestFrequency,
  type DigestFrequency,
} from "./digest-frequency";
import {
  clearQuietHours,
  formatTimeOfDay,
  quietHoursWindowFromFields,
  type QuietHoursWindow,
} from "./quiet-hours";
import {
  listActiveSubscriptionTopics,
  loadSubscriberTopicPreferences,
  replaceSubscriberTopicPreferences,
} from "./subscription-topics";
import {
  PRODUCT_UPDATES_TOPIC,
  WINBACK_TOPIC,
  type TopicPreferenceView,
} from "./topics";

/**
 * Public email preferences.
 *
 * The token is the credential: subscribers have no password and no session on
 * the marketing surface, so the capability in the email is the only thing that
 * may change their preferences. Tokens are random and unguessable, grant no
 * other access, and every update is scoped to the subscriber row the token
 * resolves to. Rotating one is an operational step, not a UI action.
 */

export type SubscriberPreferences = {
  id: string;
  email: string;
  name: string | null;
  productUpdates: boolean;
  winback: boolean;
  topics: TopicPreferenceView[];
  notifyStatusChanges: boolean;
  notifyReplies: boolean;
  digestFrequency: DigestFrequency;
  /** Local quiet window, or null when the subscriber has not set one. */
  quietHours: { start: string; end: string; timezone: string } | null;
  /** Compatibility mirror: true for daily and weekly. */
  weeklyDigest: boolean;
  workspace: { name: string; slug: string };
  product: { name: string; slug: string };
};

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export function createPreferenceToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isPreferenceToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

const SELECTION = {
  id: subscribers.id,
  productId: subscribers.productId,
  email: subscribers.email,
  name: subscribers.name,
  status: subscribers.status,
  winbackOptedOutAt: subscribers.winbackOptedOutAt,
  notifyStatusChanges: subscribers.notifyStatusChanges,
  notifyReplies: subscribers.notifyReplies,
  weeklyDigest: subscribers.weeklyDigest,
  digestFrequency: subscribers.digestFrequency,
  quietHoursStart: subscribers.quietHoursStart,
  quietHoursEnd: subscribers.quietHoursEnd,
  quietHoursTimezone: subscribers.quietHoursTimezone,
  workspaceName: workspaces.name,
  workspaceSlug: workspaces.slug,
  productName: products.name,
  productSlug: products.slug,
} as const;

async function findByToken(token: string) {
  if (!isPreferenceToken(token)) return null;

  const rows = await db
    .select(SELECTION)
    .from(subscribers)
    .innerJoin(products, eq(subscribers.productId, products.id))
    .innerJoin(workspaces, eq(products.workspaceId, workspaces.id))
    .where(eq(subscribers.unsubscribeToken, token))
    .limit(1);

  return rows[0] ?? null;
}

async function topicsFor(
  row: NonNullable<Awaited<ReturnType<typeof findByToken>>>,
): Promise<TopicPreferenceView[]> {
  const [topics, stored] = await Promise.all([
    listActiveSubscriptionTopics(row.productId),
    loadSubscriberTopicPreferences({
      productId: row.productId,
      subscriberId: row.id,
    }),
  ]);

  return topics.map((topic) => {
    const subscribed =
      topic.key === PRODUCT_UPDATES_TOPIC
        ? row.status === "active"
        : topic.key === WINBACK_TOPIC
          ? row.winbackOptedOutAt === null
          : topic.tag
            ? (stored.get(topic.key) ?? true)
            : (stored.get(topic.key) ?? false);

    return {
      key: topic.key,
      name: topic.name,
      description: topic.description,
      subscribed,
      builtIn: topic.builtIn,
      tag: topic.tag,
    };
  });
}

async function toPreferences(
  row: NonNullable<Awaited<ReturnType<typeof findByToken>>>,
): Promise<SubscriberPreferences> {
  const topics = await topicsFor(row);
  const digestFrequency = effectiveDigestFrequency(
    row.digestFrequency,
    row.weeklyDigest,
  );
  const quietHours = quietHoursWindowFromFields(row);
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    productUpdates: row.status === "active",
    winback: row.winbackOptedOutAt === null,
    topics,
    notifyStatusChanges: row.notifyStatusChanges,
    notifyReplies: row.notifyReplies,
    digestFrequency,
    quietHours: quietHours
      ? {
          start: formatTimeOfDay(quietHours.startMinute),
          end: formatTimeOfDay(quietHours.endMinute),
          timezone: quietHours.timezone,
        }
      : null,
    weeklyDigest: digestFrequency !== "off",
    workspace: { name: row.workspaceName, slug: row.workspaceSlug },
    product: { name: row.productName, slug: row.productSlug },
  };
}

export async function getSubscriberPreferences(
  token: string,
): Promise<SubscriberPreferences | null> {
  const row = await findByToken(token);
  return row ? toPreferences(row) : null;
}

export type PreferenceUpdate = {
  /** Kept for old links; topic overrides are preferred when supplied. */
  productUpdates?: boolean | undefined;
  winback?: boolean | undefined;
  topics?: Record<string, boolean> | undefined;
  /** Omitted by older links, which only knew about updates and win-back. */
  notifyStatusChanges?: boolean | undefined;
  notifyReplies?: boolean | undefined;
  digestFrequency?: DigestFrequency | undefined;
  /** Omitted by older links; null clears an existing window. */
  quietHours?: QuietHoursWindow | null | undefined;
  /** Older clients and links only knew the weekly on/off flag. */
  weeklyDigest?: boolean | undefined;
};

/**
 * Apply preferences. Resubscribing keeps the row (and its history) instead of
 * inserting a second subscriber, so a later unsubscribe still finds it.
 *
 * `product_updates` and `winback` continue to write the legacy columns because
 * the release and win-back senders use them. Additional topics are stored in
 * the join table and are opt-in by default.
 */
export async function updateSubscriberPreferences(
  token: string,
  update: PreferenceUpdate,
): Promise<SubscriberPreferences | null> {
  const row = await findByToken(token);
  if (!row) return null;

  const currentTopics = await topicsFor(row);
  const currentByKey = new Map(currentTopics.map((topic) => [topic.key, topic.subscribed]));
  const requested = update.topics ?? {};

  const productUpdates =
    requested[PRODUCT_UPDATES_TOPIC] ??
    update.productUpdates ??
    currentByKey.get(PRODUCT_UPDATES_TOPIC) ??
    row.status === "active";
  const winback =
    requested[WINBACK_TOPIC] ??
    update.winback ??
    currentByKey.get(WINBACK_TOPIC) ??
    row.winbackOptedOutAt === null;

  const now = new Date();
  // The digest is a product-update email, so it cannot outlive the
  // subscription itself. An omitted cadence is left as stored.
  const requestedFrequency =
    update.digestFrequency ??
    (update.weeklyDigest === undefined
      ? undefined
      : update.weeklyDigest
        ? "weekly"
        : "off");
  const digestFrequency = productUpdates
    ? (requestedFrequency ??
      effectiveDigestFrequency(row.digestFrequency, row.weeklyDigest))
    : "off";
  const weeklyDigest = digestFrequency !== "off";
  const updated = await db
    .update(subscribers)
    .set({
      status: productUpdates ? "active" : "unsubscribed",
      unsubscribedAt: productUpdates ? null : now,
      winbackOptedOutAt: winback ? null : now,
      ...(update.notifyStatusChanges === undefined
        ? {}
        : { notifyStatusChanges: update.notifyStatusChanges }),
      ...(update.notifyReplies === undefined
        ? {}
        : { notifyReplies: update.notifyReplies }),
      ...(update.quietHours === undefined
        ? {}
        : update.quietHours === null
          ? clearQuietHours()
          : {
              quietHoursStart: update.quietHours.startMinute,
              quietHoursEnd: update.quietHours.endMinute,
              quietHoursTimezone: update.quietHours.timezone,
            }),
      weeklyDigest,
      digestFrequency,
      updatedAt: now,
    })
    .where(eq(subscribers.id, row.id))
    .returning({ id: subscribers.id });

  if (!updated[0]) return null;

  const nextPreferences = new Map<string, boolean>();
  for (const topic of currentTopics) {
    if (topic.key === PRODUCT_UPDATES_TOPIC) {
      nextPreferences.set(topic.key, productUpdates);
    } else if (topic.key === WINBACK_TOPIC) {
      nextPreferences.set(topic.key, winback);
    } else {
      nextPreferences.set(
        topic.key,
        requested[topic.key] ?? currentByKey.get(topic.key) ?? topic.tag,
      );
    }
  }
  await replaceSubscriberTopicPreferences({
    productId: row.productId,
    subscriberId: row.id,
    preferences: nextPreferences,
  });

  // Win-back eligibility lives on the product customer account, but the
  // customer changes it through the same preference link. Keep the two
  // records in sync so a later campaign sees the opt-out even if it resolves
  // recipients by account rather than by subscriber row.
  await db
    .update(customerAccounts)
    .set({ winbackOptedOutAt: winback ? null : now, updatedAt: now })
    .where(
      and(
        eq(customerAccounts.productId, row.productId),
        eq(customerAccounts.emailNormalized, normalizeEmail(row.email)),
      ),
    );

  return getSubscriberPreferences(token);
}

/**
 * RFC 8058 one-click target. It turns off every marketing list, including
 * custom topics and the digest, but leaves transactional request status and
 * reply notifications alone. Returns false for an unknown token.
 */
export async function unsubscribeFromMarketing(token: string): Promise<boolean> {
  const row = await findByToken(token);
  if (!row) return false;
  const topics = await topicsFor(row);
  await updateSubscriberPreferences(token, {
    productUpdates: false,
    winback: false,
    digestFrequency: "off",
    topics: Object.fromEntries(topics.map((topic) => [topic.key, false])),
  });
  return true;
}
