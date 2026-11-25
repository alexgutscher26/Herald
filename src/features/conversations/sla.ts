import "server-only";

import { and, asc, eq, inArray, isNotNull, isNull, lt, lte, or } from "drizzle-orm";

import { db } from "@/db";
import { customers } from "@/db/schema/customers";
import { conversations } from "@/db/schema/conversations";
import { productSupportSettings } from "@/db/schema/support";

import { businessMinutesBetween } from "./business-time";
import { queueSlaBreachNotifications } from "./notify";

/**
 * Find waiting conversations whose first-response clock has run out.
 *
 * The customer's last message starts the clock. A team or Mira reply moves
 * `lastMessageAt` past it and pauses the clock until the customer writes again.
 * `slaBreachedAt` makes the sweep idempotent; a later customer message is newer
 * than that marker, so the thread becomes eligible for one new alert.
 *
 * The update is claimed with the same waiting predicate as the read, so a team
 * reply that lands mid-sweep cannot produce a false breach alert.
 */
export async function scanConversationSlaBreaches(
  now: Date = new Date(),
  limitPerProduct = 200,
): Promise<{ checked: number; breached: number }> {
  const settingsRows = await db
    .select({
      productId: productSupportSettings.productId,
      targetMinutes: productSupportSettings.slaFirstResponseMinutes,
      timezone: productSupportSettings.slaTimezone,
      businessHours: productSupportSettings.slaBusinessHours,
    })
    .from(productSupportSettings)
    .where(eq(productSupportSettings.slaEnabled, true));

  let checked = 0;
  let breached = 0;

  for (const settings of settingsRows) {
    const waiting = await db
      .select({
        id: conversations.id,
        workspaceId: conversations.workspaceId,
        productId: conversations.productId,
        subject: conversations.subject,
        customerName: customers.name,
        lastCustomerMessageAt: conversations.lastCustomerMessageAt,
        lastMessageAt: conversations.lastMessageAt,
      })
      .from(conversations)
      .innerJoin(customers, eq(conversations.customerId, customers.id))
      .where(
        and(
          eq(conversations.productId, settings.productId),
          inArray(conversations.status, ["queue", "open", "snoozed"]),
          isNotNull(conversations.lastCustomerMessageAt),
          lte(conversations.lastCustomerMessageAt, now),
          or(
            isNull(conversations.slaBreachedAt),
            lt(conversations.slaBreachedAt, conversations.lastCustomerMessageAt),
          ),
        ),
      )
      .orderBy(asc(conversations.lastCustomerMessageAt))
      .limit(limitPerProduct);

    for (const row of waiting) {
      checked += 1;
      const waitingSince = row.lastCustomerMessageAt;
      if (!waitingSince) continue;
      // A reply after the customer message pauses the clock.
      if (row.lastMessageAt.getTime() > waitingSince.getTime()) continue;

      let elapsed: number;
      try {
        elapsed = businessMinutesBetween(
          waitingSince,
          now,
          settings.timezone,
          settings.businessHours ?? null,
        );
      } catch {
        // A malformed legacy timezone must not stop the sweep for every other
        // product. The settings form validates new values.
        continue;
      }
      if (elapsed < settings.targetMinutes) continue;

      const claimed = await db.transaction(async (tx) => {
        const updated = await tx
          .update(conversations)
          .set({ slaBreachedAt: now })
          .where(
            and(
              eq(conversations.id, row.id),
              inArray(conversations.status, ["queue", "open", "snoozed"]),
              lte(conversations.lastCustomerMessageAt, now),
              lte(conversations.lastMessageAt, conversations.lastCustomerMessageAt),
              or(
                isNull(conversations.slaBreachedAt),
                lt(conversations.slaBreachedAt, conversations.lastCustomerMessageAt),
              ),
            ),
          )
          .returning({ id: conversations.id });
        if (!updated[0]) return false;

        await queueSlaBreachNotifications(tx, {
          workspaceId: row.workspaceId,
          productId: row.productId,
          conversationId: row.id,
          subject: row.subject,
          customerName: row.customerName ?? "Customer",
          targetMinutes: settings.targetMinutes,
          waitingSince,
          now,
        });
        return true;
      });

      if (claimed) breached += 1;
    }
  }

  return { checked, breached };
}
