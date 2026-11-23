import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { customerEvents, customers, products } from "@/db/schema";
import { resolveCustomer } from "@/features/api-v1/service";
import { emitWebhookEvent } from "@/features/webhooks/service";

import type { CustomerEventProperties } from "@/db/schema/events";

/**
 * Event ingestion.
 *
 * The token's workspace is the tenant boundary: the product must belong to that
 * workspace and the customer is resolved inside it. `event_id` is the caller's
 * dedupe key; a replay returns the stored row instead of inserting again, and
 * only the first insert emits the outbound `customer.event`.
 */

const MAX_PROPERTIES_BYTES = 4_096;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1_000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;

export type RecordEventResult =
  | {
      ok: true;
      id: string;
      customerId: string;
      customerExternalId: string | null;
      name: string;
      occurredAt: string;
      receivedAt: string;
      duplicate: boolean;
    }
  | {
      ok: false;
      status: 400 | 404;
      error: string;
      details?: Record<string, string[]>;
    };

export async function recordCustomerEvent(input: {
  workspaceId: string;
  productId: string;
  name: string;
  customer: { id?: string | undefined; external_id?: string | undefined; email?: string | undefined; name?: string | undefined };
  eventId?: string | null | undefined;
  properties?: CustomerEventProperties | undefined;
  occurredAt?: Date | undefined;
  now?: Date | undefined;
}): Promise<RecordEventResult> {
  const now = input.now ?? new Date();

  const productRows = await db
    .select({ id: products.id })
    .from(products)
    .where(
      and(eq(products.id, input.productId), eq(products.workspaceId, input.workspaceId)),
    )
    .limit(1);
  if (!productRows[0]) {
    return { ok: false, status: 404, error: "Product not found." };
  }

  const occurredAt = input.occurredAt ?? now;
  if (occurredAt.getTime() > now.getTime() + MAX_FUTURE_SKEW_MS) {
    return {
      ok: false,
      status: 400,
      error: "`occurred_at` cannot be in the future.",
      details: { occurred_at: ["Use a time in the past."] },
    };
  }
  if (occurredAt.getTime() < now.getTime() - MAX_AGE_MS) {
    return {
      ok: false,
      status: 400,
      error: "`occurred_at` is older than the 90-day retention window.",
      details: { occurred_at: ["Use a time within the last 90 days."] },
    };
  }

  const properties = input.properties ?? {};
  if (JSON.stringify(properties).length > MAX_PROPERTIES_BYTES) {
    return {
      ok: false,
      status: 400,
      error: "`properties` is too large.",
      details: { properties: ["Keep properties under 4 KB."] },
    };
  }

  const customer = await resolveCustomer(input.workspaceId, input.customer);
  if (!customer) {
    return {
      ok: false,
      status: 400,
      error: "A customer needs an `id`, `external_id` or `email`.",
      details: { customer: ["Supply an id, external_id or email."] },
    };
  }

  const eventId = input.eventId?.trim() || null;
  const inserted = await db
    .insert(customerEvents)
    .values({
      workspaceId: input.workspaceId,
      productId: input.productId,
      customerId: customer.id,
      name: input.name,
      eventId,
      properties,
      occurredAt,
      receivedAt: now,
    })
    .onConflictDoNothing()
    .returning();

  let row = inserted[0];
  const duplicate = !row;

  if (!row) {
    if (!eventId) throw new Error("Event insert conflicted without an event id.");
    const existing = await db
      .select()
      .from(customerEvents)
      .where(
        and(
          eq(customerEvents.productId, input.productId),
          eq(customerEvents.eventId, eventId),
        ),
      )
      .limit(1);
    row = existing[0];
    if (!row) throw new Error("Event insert conflicted but the row could not be read.");
  }

  const customerRows = await db
    .select({ externalId: customers.externalId })
    .from(customers)
    .where(eq(customers.id, customer.id))
    .limit(1);
  const customerExternalId = customerRows[0]?.externalId ?? null;

  if (!duplicate) {
    await emitWebhookEvent({
      workspaceId: input.workspaceId,
      event: "customer.event",
      data: {
        event_id: row.id,
        name: row.name,
        customer_id: row.customerId,
        external_id: customerExternalId,
        occurred_at: row.occurredAt.toISOString(),
        properties: row.properties,
      },
    });
  }

  return {
    ok: true,
    id: row.id,
    customerId: row.customerId,
    customerExternalId,
    name: row.name,
    occurredAt: row.occurredAt.toISOString(),
    receivedAt: row.receivedAt.toISOString(),
    duplicate,
  };
}
