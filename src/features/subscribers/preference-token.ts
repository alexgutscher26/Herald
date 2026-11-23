import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db";
import { subscribers } from "@/db/schema/subscribers";

import { createPreferenceToken } from "./preferences";

/**
 * Ensure the address has a capability token for preferences and one-click
 * unsubscribe. A missing row is created as `pending`, never `active`, so an
 * outbound message does not silently subscribe someone to product updates.
 */
export async function ensurePreferenceToken(input: {
  productId: string;
  email: string;
  emailNormalized: string;
  customerId?: string | null;
  name?: string | null;
}): Promise<string | null> {
  const token = createPreferenceToken();
  const now = new Date();
  const rows = await db
    .insert(subscribers)
    .values({
      productId: input.productId,
      email: input.email,
      emailNormalized: input.emailNormalized,
      ...(input.customerId ? { customerId: input.customerId } : {}),
      ...(input.name ? { name: input.name } : {}),
      status: "pending",
      source: "manual",
      unsubscribeToken: token,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [subscribers.productId, subscribers.emailNormalized],
      set: {
        customerId: sql`coalesce(${subscribers.customerId}, excluded.customer_id)`,
        unsubscribeToken: sql`coalesce(${subscribers.unsubscribeToken}, ${token})`,
        updatedAt: now,
      },
    })
    .returning({ token: subscribers.unsubscribeToken });

  return rows[0]?.token ?? null;
}
