import { afterAll, beforeAll, describe, expect } from "bun:test";

import { db } from "@/db";
import {
  buildDeliveryDedupeKey,
  notificationDeliveries,
  type NotificationTemplate,
} from "@/db/schema/notifications";
import { getDeliveryLog, type DeliveryStatus } from "@/db/queries/notifications";
import { normalizeEmail } from "@/lib/email";

import {
  createFeedbackPost,
  createProduct,
  createRelease,
  createWorkspace,
  uniqueLabel,
} from "./factories";
import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";

/**
 * The delivery log is the only dashboard view of the outbox. It must show
 * every status, include the content behind a message, and never mix products or
 * workspaces.
 */

beforeAll(async () => {
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

async function seedDelivery(input: {
  workspaceId: string;
  productId: string;
  template: NotificationTemplate;
  status: DeliveryStatus;
  email: string;
  createdAt: Date;
  releaseId?: string;
  feedbackPostId?: string;
  error?: string;
  sentAt?: Date;
  providerMessageId?: string;
}) {
  const emailNormalized = normalizeEmail(input.email);
  const sourceId =
    input.releaseId ?? input.feedbackPostId ?? uniqueLabel("delivery-source");

  const rows = await db
    .insert(notificationDeliveries)
    .values({
      workspaceId: input.workspaceId,
      productId: input.productId,
      template: input.template,
      releaseId: input.releaseId ?? null,
      feedbackPostId: input.feedbackPostId ?? null,
      recipientEmail: input.email,
      recipientEmailNormalized: emailNormalized,
      status: input.status,
      attemptCount: input.status === "pending" ? 0 : 1,
      error: input.error ?? null,
      sentAt: input.sentAt ?? null,
      providerMessageId: input.providerMessageId ?? null,
      createdAt: input.createdAt,
      dedupeKey: buildDeliveryDedupeKey({
        template: input.template,
        productId: input.productId,
        recipientEmailNormalized: emailNormalized,
        sourceId,
      }),
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error("Delivery insert returned no row.");
  return row;
}

describe("email delivery log", () => {
  isolatedTest("shows every status with content and counts", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const release = await createRelease({
      productId: product.id,
      title: "Faster search",
      slug: "faster-search",
    });
    const post = await createFeedbackPost({
      productId: product.id,
      title: "Dark mode",
      status: "planned",
    });

    const base = new Date("2026-05-01T09:00:00Z");
    const at = (minutes: number) => new Date(base.getTime() + minutes * 60_000);

    await seedDelivery({
      workspaceId: workspace.id,
      productId: product.id,
      template: "release_published",
      status: "sent",
      email: "sent@example.test",
      createdAt: at(0),
      sentAt: at(1),
      providerMessageId: "msg_sent",
      releaseId: release.id,
    });
    await seedDelivery({
      workspaceId: workspace.id,
      productId: product.id,
      template: "release_published",
      status: "pending",
      email: "pending@example.test",
      createdAt: at(1),
      releaseId: release.id,
    });
    await seedDelivery({
      workspaceId: workspace.id,
      productId: product.id,
      template: "feedback_status_changed",
      status: "failed",
      email: "failed@example.test",
      createdAt: at(2),
      feedbackPostId: post.id,
      error: "Email provider rejected the message (HTTP 500).",
    });
    await seedDelivery({
      workspaceId: workspace.id,
      productId: product.id,
      template: "feedback_status_changed",
      status: "skipped",
      email: "skipped@example.test",
      createdAt: at(3),
      feedbackPostId: post.id,
    });
    await seedDelivery({
      workspaceId: workspace.id,
      productId: product.id,
      template: "release_published",
      status: "bounced",
      email: "bounced@example.test",
      createdAt: at(4),
      releaseId: release.id,
      error: "Mailbox does not exist.",
    });

    // A second product in the same workspace must never appear.
    const otherProduct = await createProduct(workspace.id);
    await seedDelivery({
      workspaceId: workspace.id,
      productId: otherProduct.id,
      template: "release_published",
      status: "sent",
      email: "other-product@example.test",
      createdAt: at(5),
    });

    const log = await getDeliveryLog(product.id, workspace.id);

    expect(log.total).toBe(5);
    expect(log.counts).toEqual({
      pending: 1,
      sent: 1,
      failed: 1,
      bounced: 1,
      complained: 0,
      skipped: 1,
    });
    expect(log.rows).toHaveLength(5);
    expect(log.rows.map((row) => row.status)).toEqual([
      "bounced",
      "skipped",
      "failed",
      "pending",
      "sent",
    ]);
    expect(log.rows[0]?.releaseTitle).toBe("Faster search");
    expect(log.rows[2]?.feedbackTitle).toBe("Dark mode");
    expect(log.rows[2]?.error).toContain("HTTP 500");
    expect(log.rows[4]?.providerMessageId).toBe("msg_sent");
    expect(log.rows.map((row) => row.recipientEmail)).not.toContain(
      "other-product@example.test",
    );
  });

  isolatedTest("a foreign workspace id returns nothing", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    await seedDelivery({
      workspaceId: workspace.id,
      productId: product.id,
      template: "release_published",
      status: "sent",
      email: "member@example.test",
      createdAt: new Date("2026-05-01T09:00:00Z"),
    });

    const foreign = await createWorkspace();
    const log = await getDeliveryLog(product.id, foreign.id);

    expect(log.total).toBe(0);
    expect(log.rows).toEqual([]);
    expect(log.counts.sent).toBe(0);
  });

  isolatedTest("the limit bounds rows without changing the totals", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);

    for (let index = 0; index < 4; index += 1) {
      await seedDelivery({
        workspaceId: workspace.id,
        productId: product.id,
        template: "weekly_digest",
        status: "sent",
        email: `digest-${index}@example.test`,
        createdAt: new Date(`2026-05-0${index + 1}T09:00:00Z`),
      });
    }

    const log = await getDeliveryLog(product.id, workspace.id, 2);

    expect(log.rows).toHaveLength(2);
    expect(log.total).toBe(4);
    expect(log.counts.sent).toBe(4);
  });
});
