import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { notificationDeliveries } from "@/db/schema/notifications";
import { winbackCampaignRecipients } from "@/db/schema/winback";

import { suppressEmail } from "./suppressions";

/**
 * Provider delivery feedback.
 *
 * A webhook adapter translates provider payloads into these normalized events.
 * A bounce or complaint both suppresses the address, so later sends skip it
 * instead of repeating the harm; the delivery row keeps the terminal status so
 * the log explains what happened. Unknown message ids are ignored rather than
 * failing the batch: the provider may report on another environment.
 */

export type DeliveryEventType = "delivered" | "bounced" | "complained";

export type DeliveryEvent = {
  type: DeliveryEventType;
  messageId: string;
  reason?: string | null;
};

export type DeliveryEventSummary = {
  applied: number;
  ignored: number;
  suppressed: number;
};

export async function applyDeliveryEvents(
  events: DeliveryEvent[],
): Promise<DeliveryEventSummary> {
  const summary: DeliveryEventSummary = { applied: 0, ignored: 0, suppressed: 0 };

  for (const event of events) {
    const rows = await db
      .select({
        id: notificationDeliveries.id,
        workspaceId: notificationDeliveries.workspaceId,
        status: notificationDeliveries.status,
        sentAt: notificationDeliveries.sentAt,
        recipientEmail: notificationDeliveries.recipientEmail,
        winbackRecipientId: notificationDeliveries.winbackRecipientId,
      })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.providerMessageId, event.messageId))
      .limit(1);

    const delivery = rows[0];
    if (!delivery) {
      summary.ignored += 1;
      continue;
    }

    const now = new Date();

    if (event.type === "delivered") {
      // Confirmation only; the row is already sent and stays there.
      if (!delivery.sentAt) {
        await db
          .update(notificationDeliveries)
          .set({ sentAt: now, updatedAt: now })
          .where(eq(notificationDeliveries.id, delivery.id));
        summary.applied += 1;
      } else {
        summary.ignored += 1;
      }
      continue;
    }

    if (
      delivery.status === "bounced" ||
      delivery.status === "complained" ||
      delivery.status === "skipped"
    ) {
      summary.ignored += 1;
      continue;
    }

    const bounced = event.type === "bounced";
    const reason =
      event.reason?.trim().slice(0, 300) ||
      (bounced
        ? "The receiving server rejected this address."
        : "The recipient marked this message as spam.");

    await db
      .update(notificationDeliveries)
      .set({
        status: bounced ? "bounced" : "complained",
        error: reason,
        updatedAt: now,
      })
      .where(eq(notificationDeliveries.id, delivery.id));

    await suppressEmail({
      workspaceId: delivery.workspaceId,
      email: delivery.recipientEmail,
      reason: bounced ? "hard_bounce" : "complaint",
      note: reason,
    });

    if (delivery.winbackRecipientId) {
      await db
        .update(winbackCampaignRecipients)
        .set({
          status: bounced ? "bounced" : "failed",
          updatedAt: now,
        })
        .where(eq(winbackCampaignRecipients.id, delivery.winbackRecipientId));
    }

    summary.applied += 1;
    summary.suppressed += 1;
  }

  return summary;
}
