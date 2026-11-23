import "server-only";

import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { customers } from "@/db/schema/customers";
import { emailSuppressions } from "@/db/schema/email";
import { feedbackPosts } from "@/db/schema/feedback";
import { feedbackFollowers } from "@/db/schema/feedback-extensions";
import { products } from "@/db/schema/workspaces";
import { subscribers, type Subscriber } from "@/db/schema/subscribers";
import { isUniqueViolation } from "@/lib/error-message";
import { isValidEmail, normalizeEmail } from "@/lib/email";

import type { SubscriberImportRow } from "./csv";
import { createPreferenceToken } from "./preferences";

/**
 * Subscriber writes.
 *
 * The subscriber row is the address's durable record: unsubscribing changes
 * `status` and never deletes it, so an unsubscribe survives every later import.
 * Followers are added as `pending` (they asked about a request, not for the
 * changelog); only an explicit product-update opt-in makes them `active`.
 */

export type ImportSubscribersResult = {
  created: number;
  updated: number;
  invalid: number;
  total: number;
};

export type FollowerSyncResult = {
  followers: number;
  created: number;
  linked: number;
};

function now(): Date {
  return new Date();
}

/**
 * Ensure a customer's address exists as a subscriber, without opting them into
 * the changelog. Existing status, preferences and token are preserved.
 */
export async function ensureSubscriberForCustomer(input: {
  productId: string;
  customerId: string;
}): Promise<Subscriber | null> {
  const rows = await db
    .select({
      email: customers.email,
      emailNormalized: customers.emailNormalized,
      name: customers.name,
    })
    .from(customers)
    .innerJoin(products, eq(customers.workspaceId, products.workspaceId))
    .where(and(eq(customers.id, input.customerId), eq(products.id, input.productId)))
    .limit(1);

  const customer = rows[0];
  if (!customer?.email || !customer.emailNormalized) return null;

  const token = createPreferenceToken();
  const updatedAt = now();

  const inserted = await db
    .insert(subscribers)
    .values({
      productId: input.productId,
      email: customer.email,
      emailNormalized: customer.emailNormalized,
      name: customer.name,
      customerId: input.customerId,
      status: "pending",
      source: "follower",
      unsubscribeToken: token,
      notifyStatusChanges: true,
      notifyReplies: true,
      weeklyDigest: false,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: [subscribers.productId, subscribers.emailNormalized],
      set: {
        customerId: input.customerId,
        name: sql`coalesce(${subscribers.name}, excluded.name)`,
        unsubscribeToken: sql`coalesce(${subscribers.unsubscribeToken}, ${token})`,
        updatedAt,
      },
    })
    .returning();

  return inserted[0] ?? null;
}

/**
 * Link every current follower of this product's requests to a subscriber row.
 *
 * This is the explicit backfill for followers who existed before notifications
 * were built, and it is idempotent: running it twice creates no second address
 * and never changes an existing subscriber's status.
 */
export async function syncFollowersToSubscribers(input: {
  workspaceId: string;
  productId: string;
}): Promise<FollowerSyncResult> {
  const followers = await db
    .selectDistinct({
      customerId: customers.id,
      emailNormalized: customers.emailNormalized,
    })
    .from(feedbackFollowers)
    .innerJoin(feedbackPosts, eq(feedbackFollowers.feedbackPostId, feedbackPosts.id))
    .innerJoin(customers, eq(feedbackFollowers.customerId, customers.id))
    .where(
      and(
        eq(feedbackPosts.productId, input.productId),
        eq(customers.workspaceId, input.workspaceId),
        isNotNull(customers.emailNormalized),
        isNull(customers.bannedAt),
      ),
    )
    .limit(5_000);

  if (followers.length === 0) {
    return { followers: 0, created: 0, linked: 0 };
  }

  const existing = await db
    .select({ emailNormalized: subscribers.emailNormalized })
    .from(subscribers)
    .where(eq(subscribers.productId, input.productId));
  const existingEmails = new Set(existing.map((row) => row.emailNormalized));

  let created = 0;
  let linked = 0;
  for (const follower of followers) {
    if (!follower.emailNormalized) continue;
    const subscriber = await ensureSubscriberForCustomer({
      productId: input.productId,
      customerId: follower.customerId,
    });
    if (!subscriber) continue;
    linked += 1;
    if (!existingEmails.has(follower.emailNormalized)) {
      created += 1;
      existingEmails.add(follower.emailNormalized);
    }
  }

  return { followers: followers.length, created, linked };
}

export async function importSubscribers(input: {
  productId: string;
  rows: SubscriberImportRow[];
}): Promise<ImportSubscribersResult> {
  if (input.rows.length === 0) {
    return { created: 0, updated: 0, invalid: 0, total: 0 };
  }

  const existing = await db
    .select({ emailNormalized: subscribers.emailNormalized })
    .from(subscribers)
    .where(eq(subscribers.productId, input.productId));
  const existingEmails = new Set(existing.map((row) => row.emailNormalized));

  const nowValue = now();
  const values = input.rows.map((row) => ({
    productId: input.productId,
    email: row.email,
    emailNormalized: row.emailNormalized,
    name: row.name,
    status: row.status,
    source: row.source,
    unsubscribeToken: createPreferenceToken(),
    unsubscribedAt: row.status === "unsubscribed" ? nowValue : null,
    updatedAt: nowValue,
  }));

  // All-or-nothing, in bounded batches so one bad row cannot leave a half
  // import. The upsert deliberately preserves an existing token and customer
  // link, and an existing unsubscribe wins over the file: importing an old
  // export must never silently opt someone back in. Only a new row, or one
  // that was not already unsubscribed, takes the status in the file.
  await db.transaction(async (tx) => {
    for (let index = 0; index < values.length; index += 500) {
      await tx
        .insert(subscribers)
        .values(values.slice(index, index + 500))
        .onConflictDoUpdate({
          target: [subscribers.productId, subscribers.emailNormalized],
          set: {
            name: sql`coalesce(excluded.name, ${subscribers.name})`,
            status: sql`case when ${subscribers.status} = 'unsubscribed' then ${subscribers.status} else excluded.status end`,
            source: sql`case when ${subscribers.status} = 'unsubscribed' then ${subscribers.source} else excluded.source end`,
            unsubscribedAt: sql`case when ${subscribers.status} = 'unsubscribed' then ${subscribers.unsubscribedAt} when excluded.status = 'unsubscribed' then now() else null end`,
            updatedAt: nowValue,
          },
        });
    }
  });

  const created = values.filter((row) => !existingEmails.has(row.emailNormalized)).length;
  return {
    created,
    updated: values.length - created,
    invalid: 0,
    total: values.length,
  };
}

export type AddSubscriberResult =
  | { ok: true; id: string; requiresConfirmation: boolean }
  | { ok: false; error: string };

export async function addSubscriber(input: {
  productId: string;
  email: string;
  name?: string | null;
  /** When the workspace is in double opt-in mode, the row starts pending. */
  doubleOptIn?: boolean;
}): Promise<AddSubscriberResult> {
  const email = input.email.trim();
  if (!isValidEmail(email)) return { ok: false, error: "Enter a valid email address." };
  const emailNormalized = normalizeEmail(email);

  try {
    const rows = await db
      .insert(subscribers)
      .values({
        productId: input.productId,
        email,
        emailNormalized,
        name: input.name?.trim().slice(0, 120) || null,
        status: input.doubleOptIn ? "pending" : "active",
        source: "manual",
        unsubscribeToken: createPreferenceToken(),
        confirmationToken: input.doubleOptIn ? createPreferenceToken() : null,
        updatedAt: now(),
      })
      .returning({ id: subscribers.id });

    const row = rows[0];
    if (!row) return { ok: false, error: "Could not add that subscriber." };
    return { ok: true, id: row.id, requiresConfirmation: Boolean(input.doubleOptIn) };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: "That address is already on this product's list." };
    }
    throw error;
  }
}

export async function setSubscriberStatus(input: {
  productId: string;
  subscriberId: string;
  status: "pending" | "active" | "unsubscribed";
}): Promise<boolean> {
  const updated = await db
    .update(subscribers)
    .set({
      status: input.status,
      unsubscribedAt: input.status === "unsubscribed" ? now() : null,
      // An operator activating the row is an explicit confirmation.
      ...(input.status === "active"
        ? {
            confirmedAt: sql`coalesce(${subscribers.confirmedAt}, now())`,
            confirmationToken: null,
          }
        : {}),
      updatedAt: now(),
    })
    .where(
      and(
        eq(subscribers.id, input.subscriberId),
        eq(subscribers.productId, input.productId),
      ),
    )
    .returning({ id: subscribers.id });

  return updated.length > 0;
}

export type EraseSubscriberResult = {
  erased: boolean;
  customerErased: boolean;
};

/**
 * Erase one subscriber's personal data.
 *
 * The subscriber row carries the address and the preference token, so it is
 * deleted rather than unsubscribed. A linked public customer is deleted in the
 * same transaction, which cascades their sessions and product events. The
 * audit row records that an erasure happened, never the address itself.
 */
export async function eraseSubscriber(input: {
  workspaceId: string;
  subscriberId: string;
}): Promise<EraseSubscriberResult> {
  const rows = await db
    .select({
      id: subscribers.id,
      customerId: subscribers.customerId,
      productId: subscribers.productId,
    })
    .from(subscribers)
    .innerJoin(products, eq(subscribers.productId, products.id))
    .where(
      and(
        eq(subscribers.id, input.subscriberId),
        eq(products.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return { erased: false, customerErased: false };

  await db.transaction(async (tx) => {
    await tx
      .delete(subscribers)
      .where(
        and(
          eq(subscribers.id, row.id),
          eq(subscribers.productId, row.productId),
        ),
      );
    if (row.customerId) {
      await tx
        .delete(customers)
        .where(
          and(
            eq(customers.id, row.customerId),
            eq(customers.workspaceId, input.workspaceId),
          ),
        );
    }
  });

  return { erased: true, customerErased: Boolean(row.customerId) };
}

export async function removeSuppressions(input: {
  workspaceId: string;
  ids: string[];
}): Promise<number> {
  if (input.ids.length === 0) return 0;

  const deleted = await db
    .delete(emailSuppressions)
    .where(
      and(
        eq(emailSuppressions.workspaceId, input.workspaceId),
        inArray(emailSuppressions.id, input.ids),
      ),
    )
    .returning({ id: emailSuppressions.id });

  return deleted.length;
}
