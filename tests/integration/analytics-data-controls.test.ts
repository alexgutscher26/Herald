import { afterAll, beforeAll, describe, expect } from "bun:test";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  analyticsEvents,
  analyticsDaily,
  conversations,
  customers,
  feedbackPosts,
  feedbackStatusHistory,
  workspaceAuditEvents,
  workspaceDeletions,
  workspaceMembers,
} from "@/db/schema";
import { junoConversations } from "@/db/schema/knowledge";
import { notificationDeliveries } from "@/db/schema/notifications";
import {
  cancelWorkspaceDeletion,
  eraseCustomerData,
  getWorkspaceDeletion,
  requestWorkspaceDeletion,
  transferWorkspaceOwnership,
} from "@/features/data-controls/service";
import {
  getAnalyticsOverview,
  recalculateAnalyticsWindow,
} from "@/features/analytics/rollup";

import {
  createBoard,
  createConversation,
  createConversationMessage,
  createCustomer,
  createFeedbackPost,
  createMember,
  createProduct,
  createWorkspace,
} from "./factories";
import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";

beforeAll(async () => {
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

describe("analytics history and rollups", () => {
  isolatedTest("the database trigger records status transitions and ship time", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const board = await createBoard(product.id);
    const created = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const post = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      createdAt: created,
    });

    const initial = await db
      .select()
      .from(feedbackStatusHistory)
      .where(eq(feedbackStatusHistory.feedbackPostId, post.id));
    expect(initial).toHaveLength(1);
    expect(initial[0]?.fromStatus).toBeNull();
    expect(initial[0]?.toStatus).toBe("open");

    const shippedAt = new Date(created.getTime() + 36 * 60 * 60 * 1000);
    await db
      .update(feedbackPosts)
      .set({ status: "shipped", updatedAt: shippedAt })
      .where(eq(feedbackPosts.id, post.id));

    const transitions = await db
      .select()
      .from(feedbackStatusHistory)
      .where(eq(feedbackStatusHistory.feedbackPostId, post.id));
    expect(transitions).toHaveLength(2);
    expect(transitions.some((row) => row.fromStatus === "open" && row.toStatus === "shipped")).toBe(
      true,
    );

    await db.insert(analyticsEvents).values({
      workspaceId: workspace.id,
      productId: product.id,
      boardId: board.id,
      feedbackPostId: post.id,
      type: "submission",
      occurredAt: created,
    });

    await recalculateAnalyticsWindow({
      workspaceId: workspace.id,
      productId: product.id,
      days: 5,
    });

    const metricRows = await db
      .select({ metric: analyticsDaily.metric, value: analyticsDaily.value })
      .from(analyticsDaily)
      .where(eq(analyticsDaily.productId, product.id));
    const metrics = new Map<string, number>();
    for (const row of metricRows) {
      metrics.set(row.metric, (metrics.get(row.metric) ?? 0) + row.value);
    }
    expect(metrics.get("submissions")).toBe(1);
    expect(metrics.get("feedback_shipped")).toBe(1);
    expect(metrics.get("time_to_ship_count")).toBe(1);
    expect(metrics.get("time_to_ship_minutes") ?? 0).toBeGreaterThanOrEqual(2100);
  });

  isolatedTest("daily rollups reconcile with independent SQL counts", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const board = await createBoard(product.id);
    const customer = await createCustomer(workspace.id);
    const now = new Date();
    const occurredAt = new Date(now.getTime() - 60 * 60 * 1000);
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1),
    );
    const end = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
    );

    const eventTypes = [
      ...Array.from({ length: 3 }, () => "board_view" as const),
      ...Array.from({ length: 2 }, () => "request_view" as const),
      "submit_started" as const,
      ...Array.from({ length: 2 }, () => "submission" as const),
      ...Array.from({ length: 3 }, () => "vote" as const),
      "widget_open" as const,
      "widget_install" as const,
    ];
    await db.insert(analyticsEvents).values(
      eventTypes.map((type) => ({
        workspaceId: workspace.id,
        productId: product.id,
        boardId: board.id,
        type,
        occurredAt,
      })),
    );

    const first = await createConversation({
      workspaceId: workspace.id,
      productId: product.id,
      customerId: customer.id,
    });
    const second = await createConversation({
      workspaceId: workspace.id,
      productId: product.id,
      customerId: customer.id,
    });
    await db
      .update(conversations)
      .set({ createdAt: occurredAt, updatedAt: occurredAt, resolvedAt: occurredAt })
      .where(eq(conversations.id, first.id));
    await db
      .update(conversations)
      .set({ createdAt: occurredAt, updatedAt: occurredAt })
      .where(eq(conversations.id, second.id));

    await db.insert(junoConversations).values([
      {
        conversationId: first.id,
        productId: product.id,
        state: "resolved",
        resolvedAt: occurredAt,
        createdAt: occurredAt,
        updatedAt: occurredAt,
      },
      {
        conversationId: second.id,
        productId: product.id,
        state: "active",
        createdAt: occurredAt,
        updatedAt: occurredAt,
      },
    ]);

    await db.insert(notificationDeliveries).values([
      {
        workspaceId: workspace.id,
        productId: product.id,
        template: "feedback_reply",
        recipientEmail: "sent-one@example.test",
        recipientEmailNormalized: "sent-one@example.test",
        status: "sent",
        dedupeKey: `drill-sent-one-${workspace.id}`,
        sentAt: occurredAt,
        updatedAt: occurredAt,
        createdAt: occurredAt,
      },
      {
        workspaceId: workspace.id,
        productId: product.id,
        template: "feedback_reply",
        recipientEmail: "sent-two@example.test",
        recipientEmailNormalized: "sent-two@example.test",
        status: "sent",
        dedupeKey: `drill-sent-two-${workspace.id}`,
        sentAt: occurredAt,
        updatedAt: occurredAt,
        createdAt: occurredAt,
      },
      {
        workspaceId: workspace.id,
        productId: product.id,
        template: "feedback_reply",
        recipientEmail: "failed@example.test",
        recipientEmailNormalized: "failed@example.test",
        status: "failed",
        dedupeKey: `drill-failed-${workspace.id}`,
        error: "smtp failed",
        updatedAt: occurredAt,
        createdAt: occurredAt,
      },
      {
        workspaceId: workspace.id,
        productId: product.id,
        template: "feedback_reply",
        recipientEmail: "pending@example.test",
        recipientEmailNormalized: "pending@example.test",
        status: "pending",
        dedupeKey: `drill-pending-${workspace.id}`,
        updatedAt: occurredAt,
        createdAt: occurredAt,
      },
    ]);

    const post = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Reconcile this request",
      createdAt: new Date(occurredAt.getTime() - 60 * 60 * 1000),
    });
    await db
      .update(feedbackPosts)
      .set({ status: "shipped", updatedAt: occurredAt })
      .where(eq(feedbackPosts.id, post.id));
    await db
      .update(feedbackStatusHistory)
      .set({ changedAt: occurredAt })
      .where(
        and(
          eq(feedbackStatusHistory.feedbackPostId, post.id),
          eq(feedbackStatusHistory.toStatus, "shipped"),
        ),
      );

    await recalculateAnalyticsWindow({
      workspaceId: workspace.id,
      productId: product.id,
      days: 2,
      now,
    });
    const overview = await getAnalyticsOverview({
      workspaceId: workspace.id,
      productId: product.id,
      days: 2,
      now,
    });

    const [
      eventRows,
      conversationRows,
      resolvedRows,
      junoRows,
      deliveryRows,
      historyRows,
      shipRows,
    ] = await Promise.all([
      db.execute(sql`
        SELECT "type", count(*)::int AS value
        FROM "analytics_events"
        WHERE "product_id" = ${product.id}
          AND "occurred_at" >= ${start}
          AND "occurred_at" < ${end}
        GROUP BY "type"
      `),
      db.execute(sql`
        SELECT count(*)::int AS value
        FROM "conversations"
        WHERE "product_id" = ${product.id}
          AND "created_at" >= ${start}
          AND "created_at" < ${end}
      `),
      db.execute(sql`
        SELECT count(*)::int AS value
        FROM "conversations"
        WHERE "product_id" = ${product.id}
          AND "resolved_at" >= ${start}
          AND "resolved_at" < ${end}
      `),
      db.execute(sql`
        SELECT count(*)::int AS value
        FROM "juno_conversations"
        WHERE "product_id" = ${product.id}
          AND "resolved_at" >= ${start}
          AND "resolved_at" < ${end}
      `),
      db.execute(sql`
        SELECT "status", count(*)::int AS value
        FROM "notification_deliveries"
        WHERE "product_id" = ${product.id}
          AND coalesce("sent_at", "updated_at") >= ${start}
          AND coalesce("sent_at", "updated_at") < ${end}
          AND "status" IN ('sent', 'failed')
        GROUP BY "status"
      `),
      db.execute(sql`
        SELECT count(*)::int AS value
        FROM "feedback_status_history"
        WHERE "product_id" = ${product.id}
          AND "to_status" = 'shipped'
          AND "changed_at" >= ${start}
          AND "changed_at" < ${end}
      `),
      db.execute(sql`
        WITH first_ship AS (
          SELECT DISTINCT ON (h."feedback_post_id") h."feedback_post_id", h."changed_at"
          FROM "feedback_status_history" h
          WHERE h."product_id" = ${product.id}
            AND h."to_status" = 'shipped'
          ORDER BY h."feedback_post_id", h."changed_at"
        )
        SELECT count(*)::int AS count,
               coalesce(sum(extract(epoch from (s."changed_at" - p."created_at")) / 60), 0)::int AS minutes
        FROM first_ship s
        INNER JOIN "feedback_posts" p ON p."id" = s."feedback_post_id"
        WHERE s."changed_at" >= ${start}
          AND s."changed_at" < ${end}
      `),
    ]);

    const eventCounts = new Map(
      (eventRows.rows as Array<{ type: string; value: number }>).map((row) => [
        row.type,
        Number(row.value),
      ]),
    );
    const conversationCount = Number(
      (conversationRows.rows[0] as { value: number }).value,
    );
    const resolvedCount = Number((resolvedRows.rows[0] as { value: number }).value);
    const junoResolvedCount = Number((junoRows.rows[0] as { value: number }).value);
    const deliveryCounts = new Map(
      (deliveryRows.rows as Array<{ status: string; value: number }>).map((row) => [
        row.status,
        Number(row.value),
      ]),
    );
    const shippedCount = Number((historyRows.rows[0] as { value: number }).value);
    const ship = shipRows.rows[0] as { count: number; minutes: number };
    const shipCount = Number(ship.count);
    const shipMinutes = Number(ship.minutes);

    expect(overview.totals.board_views).toBe(eventCounts.get("board_view") ?? 0);
    expect(overview.totals.request_views).toBe(eventCounts.get("request_view") ?? 0);
    expect(overview.totals.submit_started).toBe(eventCounts.get("submit_started") ?? 0);
    expect(overview.totals.submissions).toBe(eventCounts.get("submission") ?? 0);
    expect(overview.totals.votes).toBe(eventCounts.get("vote") ?? 0);
    expect(overview.totals.widget_opens).toBe(eventCounts.get("widget_open") ?? 0);
    expect(overview.totals.widget_installs).toBe(eventCounts.get("widget_install") ?? 0);
    expect(overview.totals.conversations_started).toBe(conversationCount);
    expect(overview.totals.conversations_resolved).toBe(resolvedCount);
    expect(overview.totals.juno_resolved).toBe(junoResolvedCount);
    expect(overview.totals.emails_sent).toBe(deliveryCounts.get("sent") ?? 0);
    expect(overview.totals.emails_failed).toBe(deliveryCounts.get("failed") ?? 0);
    expect(overview.totals.feedback_shipped).toBe(shippedCount);
    expect(overview.totals.time_to_ship_count).toBe(shipCount);
    expect(overview.totals.time_to_ship_minutes).toBe(shipMinutes);
    expect(overview.averageTimeToShipMinutes).toBe(
      shipCount > 0 ? Math.round(shipMinutes / shipCount) : null,
    );
    expect(overview.junoResolved).toBe(1);
    expect(overview.junoInvolved).toBe(2);
    expect(overview.emailDeliveryRate).toBeCloseTo(2 / 3, 5);

    // The fixture is deliberately hand-countable so a wrong SQL query cannot
    // make both sides agree on the same mistaken number.
    expect(overview.totals).toMatchObject({
      board_views: 3,
      request_views: 2,
      submit_started: 1,
      submissions: 2,
      votes: 3,
      widget_opens: 1,
      widget_installs: 1,
      conversations_started: 2,
      conversations_resolved: 1,
      juno_resolved: 1,
      emails_sent: 2,
      emails_failed: 1,
      feedback_shipped: 1,
      time_to_ship_count: 1,
      time_to_ship_minutes: 60,
    });
  });

  isolatedTest("first response counts a customer-visible reply, not an internal note", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const owner = await createMember(workspace.id, { role: "owner" });
    const customer = await createCustomer(workspace.id);
    const conversation = await createConversation({
      workspaceId: workspace.id,
      productId: product.id,
      customerId: customer.id,
    });
    const firstCustomerMessage = new Date(Date.now() - 3 * 60 * 60 * 1000);

    await createConversationMessage({
      conversation,
      authorType: "customer",
      body: "Can you help?",
      createdAt: firstCustomerMessage,
    });
    await createConversationMessage({
      conversation,
      authorType: "team",
      authorUserId: owner.user.id,
      kind: "note",
      body: "Internal triage note.",
      createdAt: new Date(firstCustomerMessage.getTime() + 10 * 60 * 1000),
    });
    await createConversationMessage({
      conversation,
      authorType: "team",
      authorUserId: owner.user.id,
      kind: "message",
      body: "Happy to help.",
      createdAt: new Date(firstCustomerMessage.getTime() + 30 * 60 * 1000),
    });

    const overview = await getAnalyticsOverview({
      workspaceId: workspace.id,
      productId: product.id,
      days: 5,
    });
    expect(overview.averageFirstResponseMinutes).toBe(30);
  });
});

describe("workspace data controls", () => {
  isolatedTest("ownership transfer leaves one owner and an audit row", async () => {
    const workspace = await createWorkspace();
    const owner = await createMember(workspace.id, { role: "owner" });
    const teammate = await createMember(workspace.id, { role: "editor" });

    const result = await transferWorkspaceOwnership({
      workspaceId: workspace.id,
      actorUserId: owner.user.id,
      targetMemberId: teammate.member.id,
    });
    expect(result.ok).toBe(true);

    const members = await db
      .select({ userId: workspaceMembers.userId, role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, workspace.id));
    expect(members.filter((row) => row.role === "owner")).toHaveLength(1);
    expect(members.find((row) => row.userId === teammate.user.id)?.role).toBe("owner");
    expect(members.find((row) => row.userId === owner.user.id)?.role).toBe("admin");

    const audit = await db
      .select({ action: workspaceAuditEvents.action })
      .from(workspaceAuditEvents)
      .where(eq(workspaceAuditEvents.workspaceId, workspace.id));
    expect(audit.some((row) => row.action === "workspace.ownership_transferred")).toBe(true);
  });

  isolatedTest("deletion has a 30-day grace period and can be cancelled", async () => {
    const workspace = await createWorkspace();
    const owner = await createMember(workspace.id, { role: "owner" });

    const requested = await requestWorkspaceDeletion({
      workspaceId: workspace.id,
      actorUserId: owner.user.id,
    });
    const days = (requested.purgeAfter.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30.1);

    const pending = await getWorkspaceDeletion(workspace.id);
    expect(pending?.cancelledAt).toBeNull();

    expect(
      await cancelWorkspaceDeletion({
        workspaceId: workspace.id,
        actorUserId: owner.user.id,
      }),
    ).toBe(true);

    const cancelled = await db
      .select({ cancelledAt: workspaceDeletions.cancelledAt })
      .from(workspaceDeletions)
      .where(eq(workspaceDeletions.workspaceId, workspace.id));
    expect(cancelled[0]?.cancelledAt).not.toBeNull();

    const audit = await db
      .select({ action: workspaceAuditEvents.action })
      .from(workspaceAuditEvents)
      .where(eq(workspaceAuditEvents.workspaceId, workspace.id));
    expect(audit.map((row) => row.action)).toContain("workspace.deletion_requested");
    expect(audit.map((row) => row.action)).toContain("workspace.deletion_cancelled");
  });

  isolatedTest("erasing a customer removes only that workspace's matching row", async () => {
    const first = await createWorkspace();
    const second = await createWorkspace();
    const owner = await createMember(first.id, { role: "owner" });
    const customer = await createCustomer(first.id, { email: "erase-me@example.test" });
    const other = await createCustomer(second.id, { email: "erase-me@example.test" });

    expect(
      await eraseCustomerData({
        workspaceId: first.id,
        actorUserId: owner.user.id,
        email: "erase-me@example.test",
      }),
    ).toEqual({ deleted: true });

    const gone = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, customer.id), eq(customers.workspaceId, first.id)));
    expect(gone).toHaveLength(0);

    const untouched = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.id, other.id));
    expect(untouched).toHaveLength(1);
  });
});
