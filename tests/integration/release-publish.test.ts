import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { attachDatabaseHandle, db, type Database } from "@/db";
import * as schema from "@/db/schema";
import {
  feedbackFollowers,
  feedbackPosts,
  inAppNotifications,
  notificationDeliveries,
  releases,
  subscribers,
} from "@/db/schema";
import { suppressEmail } from "@/features/email/suppressions";
import { publishDueReleases } from "@/features/releases/publisher";
import { normalizeEmail } from "@/lib/email";

import {
  createBoard,
  createCustomer,
  createFeedbackPost,
  createProduct,
  createRelease,
  createReleaseFeedbackLink,
  createWorkspace,
  uniqueLabel,
} from "./factories";
import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
  testDatabaseConnectionString,
  testDatabaseHandle,
} from "./harness";

/**
 * Release publish fan-out and scheduled-publish concurrency.
 *
 * The first test follows the same path a cron run uses: a due scheduled release,
 * its linked requests and the real notification outbox. The second test uses a
 * separate connection pool because a single transaction would hide the row
 * lock that makes publishing exactly once.
 */

beforeAll(async () => {
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

async function addFollower(postId: string, customerId: string): Promise<void> {
  await db.insert(feedbackFollowers).values({
    feedbackPostId: postId,
    customerId,
    source: "board",
  });
}

async function addSubscriber(input: {
  productId: string;
  customerId?: string | null;
  email: string;
  status?: "pending" | "active" | "unsubscribed";
}): Promise<void> {
  await db.insert(subscribers).values({
    productId: input.productId,
    customerId: input.customerId ?? null,
    email: input.email,
    emailNormalized: normalizeEmail(input.email),
    status: input.status ?? "active",
    source: "manual",
  });
}

describe("release publishing", () => {
  isolatedTest("emails only entitled request participants and active subscribers", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id, {
      publicChangelogEnabled: true,
    });
    const publicBoard = await createBoard(product.id);
    const privateBoard = await createBoard(product.id, { visibility: "private" });

    const visible = await createFeedbackPost({
      productId: product.id,
      boardId: publicBoard.id,
      title: "Visible request",
    });
    const hidden = await createFeedbackPost({
      productId: product.id,
      boardId: publicBoard.id,
      title: "Hidden request",
      hiddenAt: new Date(),
    });
    const privateRequest = await createFeedbackPost({
      productId: product.id,
      boardId: privateBoard.id,
      title: "Private request",
    });
    const mergeTarget = await createFeedbackPost({
      productId: product.id,
      boardId: publicBoard.id,
      title: "Merge target",
    });
    const merged = await createFeedbackPost({
      productId: product.id,
      boardId: publicBoard.id,
      title: "Merged request",
      mergedIntoId: mergeTarget.id,
    });

    const visibleFollower = await createCustomer(workspace.id, {
      email: `${uniqueLabel("visible-follower")}@example.test`,
    });
    const hiddenFollower = await createCustomer(workspace.id, {
      email: `${uniqueLabel("hidden-follower")}@example.test`,
    });
    const privateFollower = await createCustomer(workspace.id, {
      email: `${uniqueLabel("private-follower")}@example.test`,
    });
    const mergedFollower = await createCustomer(workspace.id, {
      email: `${uniqueLabel("merged-follower")}@example.test`,
    });
    const activeEmail = `${uniqueLabel("active-subscriber")}@example.test`;
    const activeCustomer = await createCustomer(workspace.id, { email: activeEmail });
    const bannedCustomer = await createCustomer(workspace.id, {
      email: `${uniqueLabel("banned-subscriber")}@example.test`,
      bannedAt: new Date(),
    });

    await addFollower(visible.id, visibleFollower.id);
    await addFollower(hidden.id, hiddenFollower.id);
    await addFollower(privateRequest.id, privateFollower.id);
    await addFollower(merged.id, mergedFollower.id);

    await addSubscriber({
      productId: product.id,
      customerId: activeCustomer.id,
      email: activeEmail,
    });
    await addSubscriber({
      productId: product.id,
      customerId: bannedCustomer.id,
      email: bannedCustomer.email ?? "",
    });

    const suppressedEmail = `${uniqueLabel("suppressed-subscriber")}@example.test`;
    await addSubscriber({ productId: product.id, email: suppressedEmail });
    await suppressEmail({
      workspaceId: workspace.id,
      email: suppressedEmail,
      reason: "hard_bounce",
    });

    const release = await createRelease({
      productId: product.id,
      status: "scheduled",
      scheduledFor: new Date(Date.now() - 60_000),
      title: "Audience-safe release",
    });
    for (const request of [visible, hidden, privateRequest, merged]) {
      await createReleaseFeedbackLink({
        productId: product.id,
        releaseId: release.id,
        feedbackPostId: request.id,
      });
    }

    const publish = await publishDueReleases({ now: new Date() });
    expect(publish.published.map((item) => item.id)).toEqual([release.id]);
    expect(publish.failed).toEqual([]);

    const deliveries = await db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.productId, product.id));
    const releaseDeliveries = deliveries.filter(
      (delivery) =>
        delivery.template === "release_published" && delivery.releaseId === release.id,
    );
    expect(releaseDeliveries.map((delivery) => delivery.recipientEmail).sort()).toEqual(
      [activeEmail].sort(),
    );
    expect(releaseDeliveries[0]?.recipientEmailNormalized).toBe(normalizeEmail(activeEmail));

    const statusDeliveries = deliveries.filter(
      (delivery) => delivery.template === "feedback_status_changed",
    );
    expect(statusDeliveries.map((delivery) => delivery.feedbackPostId)).toEqual([visible.id]);

    // The hidden, private and merged requests were marked shipped internally,
    // but they cannot email, in-app notify or otherwise disclose themselves.
    const inApp = await db
      .select()
      .from(inAppNotifications)
      .where(
        and(
          eq(inAppNotifications.releaseId, release.id),
          inArray(inAppNotifications.customerId, [
            visibleFollower.id,
            hiddenFollower.id,
            privateFollower.id,
            mergedFollower.id,
            activeCustomer.id,
            bannedCustomer.id,
          ]),
        ),
      );
    expect(inApp.map((row) => row.customerId).sort()).toEqual(
      [visibleFollower.id, activeCustomer.id].sort(),
    );

    const requestStatuses = await db
      .select({ id: feedbackPosts.id, status: feedbackPosts.status })
      .from(feedbackPosts)
      .where(inArray(feedbackPosts.id, [visible.id, hidden.id, privateRequest.id, merged.id]));
    expect(requestStatuses.every((row) => row.status === "shipped")).toBe(true);
  });
});

test(
  "concurrent scheduled publishers publish once and notify each recipient once",
  async () => {
    const pool = new Pool({
      connectionString: testDatabaseConnectionString(),
      max: 4,
    });
    pool.on("error", () => {});
    const pooled: Database = drizzle(pool, { schema });

    attachDatabaseHandle(pooled);
    let workspaceId: string | null = null;

    try {
      const workspace = await createWorkspace();
      workspaceId = workspace.id;
      const product = await createProduct(workspace.id, {
        publicChangelogEnabled: true,
      });
      const email = `${uniqueLabel("concurrent-release")}@example.test`;
      const customer = await createCustomer(workspace.id, { email });
      await addSubscriber({
        productId: product.id,
        customerId: customer.id,
        email,
      });

      const release = await createRelease({
        productId: product.id,
        status: "scheduled",
        scheduledFor: new Date(Date.now() - 60_000),
        title: "Concurrent release",
      });

      const now = new Date();
      const [first, second] = await Promise.all([
        publishDueReleases({ now, limit: 50 }),
        publishDueReleases({ now, limit: 50 }),
      ]);

      expect(first.published.length + second.published.length).toBe(1);
      const publishedIds = [...first.published, ...second.published].map((row) => row.id);
      expect(publishedIds).toEqual([release.id]);

      const rows = await pooled
        .select({
          status: releases.status,
          scheduledFor: releases.scheduledFor,
          publishedAt: releases.publishedAt,
        })
        .from(releases)
        .where(eq(releases.id, release.id));
      expect(rows[0]?.status).toBe("published");
      expect(rows[0]?.scheduledFor).toBeNull();
      expect(rows[0]?.publishedAt).not.toBeNull();

      const deliveries = await pooled
        .select({ id: notificationDeliveries.id })
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.releaseId, release.id));
      expect(deliveries).toHaveLength(1);

      const inApp = await pooled
        .select({ id: inAppNotifications.id })
        .from(inAppNotifications)
        .where(
          and(
            eq(inAppNotifications.releaseId, release.id),
            eq(inAppNotifications.customerId, customer.id),
          ),
        );
      expect(inApp).toHaveLength(1);
    } finally {
      try {
        if (workspaceId) {
          await pool.query(`DELETE FROM "workspaces" WHERE "id" = $1`, [workspaceId]);
        }
      } finally {
        attachDatabaseHandle(testDatabaseHandle());
        await pool.end();
      }
    }
  },
  40_000,
);
