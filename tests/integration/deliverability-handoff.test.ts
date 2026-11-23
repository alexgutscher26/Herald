import { afterAll, beforeAll, describe, expect } from "bun:test";

import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";

import { POST as deliveryWebhook } from "@/app/api/email/webhook/route";
import { db } from "@/db";
import { emailSuppressions } from "@/db/schema";
import {
  conversationMessages,
  conversationNotifications,
  conversations,
} from "@/db/schema/conversations";
import { feedbackPosts } from "@/db/schema/feedback";
import { notificationDeliveries } from "@/db/schema/notifications";
import { startCustomerConversation } from "@/features/conversations/customer";
import { createRequestFromConversation } from "@/features/conversations/handoff";
import { listConversations } from "@/features/conversations/queries";
import { applyDeliveryEvents } from "@/features/email/events";
import { isEmailSuppressed } from "@/features/email/suppressions";
import { createGuestCustomerSession } from "@/features/customer-session/session";

import {
  createBoard,
  createConversation,
  createConversationMessage,
  createCustomer,
  createMember,
  createProduct,
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
 * Deliverability feedback, pre-inbox spam screening and the feedback handoff,
 * all against real Postgres.
 */

let previous: Record<string, string | undefined> = {};

beforeAll(async () => {
  previous = {
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  };
  process.env.BETTER_AUTH_URL ??= "http://app.local";
  process.env.BETTER_AUTH_SECRET ??= "integration-secret-value-at-least-32-chars";
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

async function queuedDelivery(input: {
  workspaceId: string;
  productId: string;
  email: string;
  messageId: string;
}) {
  const [row] = await db
    .insert(notificationDeliveries)
    .values({
      workspaceId: input.workspaceId,
      productId: input.productId,
      template: "release_published",
      recipientEmail: input.email,
      recipientEmailNormalized: input.email,
      status: "sent",
      sentAt: new Date(),
      providerMessageId: input.messageId,
      dedupeKey: uniqueLabel("delivery"),
    })
    .returning();
  if (!row) throw new Error("Delivery insert returned no row.");
  return row;
}

describe("delivery feedback", () => {
  isolatedTest("bounces and complaints update the log and suppress the address", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const bouncedEmail = `${uniqueLabel("bounce")}@example.test`;
    const complainedEmail = `${uniqueLabel("complaint")}@example.test`;

    const bounced = await queuedDelivery({
      workspaceId: workspace.id,
      productId: product.id,
      email: bouncedEmail,
      messageId: "msg_bounce_1",
    });
    const complained = await queuedDelivery({
      workspaceId: workspace.id,
      productId: product.id,
      email: complainedEmail,
      messageId: "msg_complaint_1",
    });

    const summary = await applyDeliveryEvents([
      { type: "bounced", messageId: "msg_bounce_1", reason: "550 mailbox unavailable" },
      { type: "complained", messageId: "msg_complaint_1" },
      { type: "delivered", messageId: "msg_unknown_1" },
    ]);
    expect(summary).toMatchObject({ applied: 2, suppressed: 2, ignored: 1 });

    const [bouncedRow] = await db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.id, bounced.id));
    expect(bouncedRow?.status).toBe("bounced");
    expect(bouncedRow?.error).toContain("550");
    expect(await isEmailSuppressed(workspace.id, bouncedEmail)).toBe(true);

    const [complainedRow] = await db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.id, complained.id));
    expect(complainedRow?.status).toBe("complained");
    expect(await isEmailSuppressed(workspace.id, complainedEmail)).toBe(true);

    const suppressions = await db
      .select()
      .from(emailSuppressions)
      .where(eq(emailSuppressions.workspaceId, workspace.id));
    expect(
      suppressions.map((row) => row.reason).sort(),
    ).toEqual(["complaint", "hard_bounce"]);

    // A replayed provider event is inert; no duplicate suppression either.
    const replay = await applyDeliveryEvents([
      { type: "bounced", messageId: "msg_bounce_1" },
    ]);
    expect(replay.applied).toBe(0);
    expect(
      await db
        .select({ id: emailSuppressions.id })
        .from(emailSuppressions)
        .where(eq(emailSuppressions.workspaceId, workspace.id)),
    ).toHaveLength(2);
  });

  isolatedTest("the webhook is closed without a secret and records an authorized batch", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const email = `${uniqueLabel("hook")}@example.test`;
    const delivery = await queuedDelivery({
      workspaceId: workspace.id,
      productId: product.id,
      email,
      messageId: "msg_hook_1",
    });

    const body = JSON.stringify({
      events: [{ type: "complained", messageId: "msg_hook_1" }],
    });
    const request = (authorization?: string) =>
      new NextRequest("http://app.local/api/email/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authorization ? { authorization } : {}),
        },
        body,
      });

    const saved = process.env.EMAIL_WEBHOOK_SECRET;
    try {
      delete process.env.EMAIL_WEBHOOK_SECRET;
      expect((await deliveryWebhook(request("Bearer whatever-long-enough-secret"))).status).toBe(503);

      process.env.EMAIL_WEBHOOK_SECRET = "test-webhook-secret-0123456789";
      expect((await deliveryWebhook(request())).status).toBe(401);
      expect(
        (await deliveryWebhook(request("Bearer wrong-secret-value-123456789"))).status,
      ).toBe(401);

      const accepted = await deliveryWebhook(
        request("Bearer test-webhook-secret-0123456789"),
      );
      expect(accepted.status).toBe(202);
      expect(await accepted.json()).toMatchObject({ applied: 1, suppressed: 1 });

      const [row] = await db
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.id, delivery.id));
      expect(row?.status).toBe("complained");
    } finally {
      if (saved === undefined) delete process.env.EMAIL_WEBHOOK_SECRET;
      else process.env.EMAIL_WEBHOOK_SECRET = saved;
    }
  });
});

describe("pre-inbox spam screening", () => {
  isolatedTest("a link-stuffed widget thread lands in Spam and never alerts the team", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const product = await createProduct(workspace.id, { publicFeedbackEnabled: true });
    const owner = await createMember(workspace.id, { role: "owner" });
    const slugs = { workspaceSlug: workspace.slug, productSlug: product.slug };

    const spamSession = await createGuestCustomerSession(workspace.id);
    const started = await startCustomerConversation({
      ...slugs,
      subject: "Cheap backlinks",
      body: "Buy backlinks now https://a.test https://b.test https://c.test https://d.test",
      sessionCookie: spamSession.cookieValue,
    });
    if (started.state !== "ready") throw new Error("unreachable");

    const [row] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, started.conversationId));
    expect(row?.status).toBe("spam");
    expect(row?.spamReason).toContain("many_links");
    expect(row?.unreadForTeam).toBe(0);

    expect(
      await db
        .select({ id: conversationNotifications.id })
        .from(conversationNotifications)
        .where(
          eq(conversationNotifications.conversationId, started.conversationId),
        ),
    ).toHaveLength(0);

    const { items } = await listConversations({
      productId: product.id,
      userId: owner.user.id,
      filters: { view: "queue", query: "", assignee: "any" },
    });
    expect(items.map((item) => item.id)).not.toContain(started.conversationId);

    const spamView = await listConversations({
      productId: product.id,
      userId: owner.user.id,
      filters: { view: "spam", query: "", assignee: "any" },
    });
    expect(spamView.items.map((item) => item.id)).toContain(
      started.conversationId,
    );

    // A genuine message still reaches Queue with its alert.
    const normalSession = await createGuestCustomerSession(workspace.id);
    const normal = await startCustomerConversation({
      ...slugs,
      subject: "Export fails",
      body: "The export button does nothing since yesterday.",
      sessionCookie: normalSession.cookieValue,
    });
    if (normal.state !== "ready") throw new Error("unreachable");

    const [normalRow] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, normal.conversationId));
    expect(normalRow?.status).toBe("queue");
    expect(normalRow?.spamReason).toBeNull();
    expect(
      await db
        .select({ id: conversationNotifications.id })
        .from(conversationNotifications)
        .where(
          eq(conversationNotifications.conversationId, normal.conversationId),
        ),
    ).toHaveLength(1);
  });
});

describe("feedback handoff", () => {
  isolatedTest("files a request as the customer and notes it in the thread", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const member = await createMember(workspace.id, { role: "admin" });
    const customer = await createCustomer(workspace.id, {
      name: "Ada Lovelace",
      email: "ada@example.test",
    });
    const board = await createBoard(product.id);
    const conversation = await createConversation({
      workspaceId: workspace.id,
      productId: product.id,
      customerId: customer.id,
      subject: "Bulk CSV export",
    });
    await createConversationMessage({
      conversation,
      authorType: "customer",
      body: "Please let me export every row at once instead of page by page.",
    });

    const created = await createRequestFromConversation({
      productId: product.id,
      conversationId: conversation.id,
      userId: member.user.id,
      boardId: board.id,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const [post] = await db
      .select()
      .from(feedbackPosts)
      .where(eq(feedbackPosts.id, created.data.postId));
    expect(post).toMatchObject({
      productId: product.id,
      boardId: board.id,
      authorCustomerId: customer.id,
      authorLabel: "Ada Lovelace",
      authorEmail: "ada@example.test",
      title: "Bulk CSV export",
      body: "Please let me export every row at once instead of page by page.",
      status: "open",
      category: "feature_request",
      hiddenAt: null,
    });

    const notes = await db
      .select()
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.conversationId, conversation.id),
          eq(conversationMessages.kind, "note"),
        ),
      );
    expect(notes).toHaveLength(1);
    expect(notes[0]?.body).toContain("Bulk CSV export");
    expect(notes[0]?.authorUserId).toBe(member.user.id);

    // A board from another product is refused, as is a foreign conversation.
    const other = await createWorkspace();
    const otherProduct = await createProduct(other.id);
    const foreignBoard = await createBoard(otherProduct.id);
    expect(
      await createRequestFromConversation({
        productId: product.id,
        conversationId: conversation.id,
        userId: member.user.id,
        boardId: foreignBoard.id,
      }),
    ).toEqual({ ok: false, error: "Choose an active board in this product." });

    const foreignCustomer = await createCustomer(other.id);
    const foreignConversation = await createConversation({
      workspaceId: other.id,
      productId: otherProduct.id,
      customerId: foreignCustomer.id,
    });
    expect(
      await createRequestFromConversation({
        productId: product.id,
        conversationId: foreignConversation.id,
        userId: member.user.id,
        boardId: board.id,
      }),
    ).toEqual({ ok: false, error: "That conversation no longer exists." });
  });
});
