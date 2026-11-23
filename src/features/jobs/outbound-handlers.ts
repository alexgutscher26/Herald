import "server-only";

import { z } from "zod";

import { db } from "@/db";
import { customers, notificationDeliveries } from "@/db/schema";
import { eq } from "drizzle-orm";

import { scheduleDueOutboundMessages, deliverOutboundMessage } from "@/features/engagement/service";

import type { JobHandler, JobType } from "./types";

const schedulePayload = z.object({});
const deliverPayload = z.object({
  messageId: z.uuid(),
  runKey: z.string().min(1).max(80),
});

export const outboundHandlers: Partial<Record<JobType, JobHandler>> = {
  schedule_outbound_messages: async (payload) => {
    schedulePayload.parse(payload);
    return (await scheduleDueOutboundMessages()) as unknown as Record<string, unknown>;
  },
  deliver_outbound_message: async (payload) => {
    const parsed = deliverPayload.parse(payload);
    const result = await deliverOutboundMessage(parsed.messageId, parsed.runKey);
    if (!result) return { ignored: "message_not_found" };
    return result as unknown as Record<string, unknown>;
  },
};

/** Used by the outbound detail page to show a live delivery preview. */
export async function outboundDeliveryPreview(productId: string, messageId: string) {
  const rows = await db
    .select({
      id: notificationDeliveries.id,
      status: notificationDeliveries.status,
      recipientEmail: notificationDeliveries.recipientEmail,
      sentAt: notificationDeliveries.sentAt,
      error: notificationDeliveries.error,
      customerName: customers.name,
    })
    .from(notificationDeliveries)
    .leftJoin(customers, eq(notificationDeliveries.recipientCustomerId, customers.id))
    .where(eq(notificationDeliveries.outboundMessageId, messageId))
    .limit(50);
  return rows;
}
