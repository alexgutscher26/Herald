import { afterAll, beforeAll, describe, expect } from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import {
  conversationMessages,
  conversations,
  customers,
  jobs,
  slackConversationLinks,
  slackIntegrations,
} from "@/db/schema";
import {
  appendSlackSupportReply,
  parseSupportCommand,
  queueSlackSupportMirror,
  startSlackSupportThread,
} from "@/features/slack/support";

import { createProduct, createWorkspace, uniqueLabel } from "./factories";
import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";

/**
 * Slack support threads against real Postgres. No Slack API is called: the
 * route's signature and retry behavior are covered by slack.test.ts, while
 * these tests exercise the thread mapping and tenant rules directly.
 */

beforeAll(async () => {
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

async function connectSlack(input: {
  workspaceId: string;
  productId: string;
  teamId?: string;
  channelId?: string;
}) {
  const teamId = input.teamId ?? uniqueLabel("T");
  const channelId = input.channelId ?? uniqueLabel("C");
  const rows = await db
    .insert(slackIntegrations)
    .values({
      workspaceId: input.workspaceId,
      productId: input.productId,
      teamId,
      teamName: "Support Team",
      botUserId: "U_BOT",
      accessToken: "xoxb-test-token",
      scopes: "channels:history,chat:write",
      channelId,
      channelName: "support",
      active: true,
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("Slack integration insert returned no row.");
  return row;
}

describe("Slack support commands", () => {
  isolatedTest("parses !support without swallowing lookalike words", async () => {
    expect(parseSupportCommand("!support My export fails")).toEqual({
      body: "My export fails",
    });
    expect(parseSupportCommand("  !SUPPORT   line one\nline two  ")).toEqual({
      body: "line one\nline two",
    });
    expect(parseSupportCommand("!support")).toEqual({ body: "" });
    expect(parseSupportCommand("!supporting is not a command")).toBeNull();
    expect(parseSupportCommand("plain feedback")).toBeNull();
  });

  isolatedTest("starts a conversation, customer and thread link in one transaction", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const integration = await connectSlack({
      workspaceId: workspace.id,
      productId: product.id,
    });

    const started = await startSlackSupportThread({
      integration,
      teamId: integration.teamId,
      channelId: integration.channelId!,
      messageTs: "1700000000.000100",
      body: "My export fails\nIt happens every time.",
      authorName: "Ada",
      slackUserId: "U_ADA",
    });
    if (!started.ok) throw new Error(started.error);
    expect(started.created).toBe(true);
    expect(started.duplicate).toBe(false);

    const conversationRows = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, started.conversationId));
    expect(conversationRows[0]).toMatchObject({
      workspaceId: workspace.id,
      productId: product.id,
      status: "queue",
      subject: "My export fails",
      unreadForTeam: 1,
      sourceContext: { channel: "slack" },
    });

    const messageRows = await db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, started.conversationId));
    expect(messageRows).toHaveLength(1);
    expect(messageRows[0]).toMatchObject({
      productId: product.id,
      authorType: "customer",
      authorCustomerId: conversationRows[0]!.customerId,
      channel: "slack",
      body: "My export fails\nIt happens every time.",
    });

    const customerRows = await db
      .select()
      .from(customers)
      .where(eq(customers.id, conversationRows[0]!.customerId));
    expect(customerRows[0]).toMatchObject({
      workspaceId: workspace.id,
      name: "Ada",
      externalId: "slack:T:U_ADA".replace("T", integration.teamId),
    });

    const linkRows = await db
      .select()
      .from(slackConversationLinks)
      .where(eq(slackConversationLinks.conversationId, started.conversationId));
    expect(linkRows[0]).toMatchObject({
      teamId: integration.teamId,
      channelId: integration.channelId,
      threadTs: "1700000000.000100",
      createdBySlackUser: "U_ADA",
    });
  });

  isolatedTest("continues the mapped thread, dedupes retries and reopens resolved threads", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const integration = await connectSlack({
      workspaceId: workspace.id,
      productId: product.id,
    });

    const started = await startSlackSupportThread({
      integration,
      teamId: integration.teamId,
      channelId: integration.channelId!,
      messageTs: "1700000000.000200",
      body: "Cannot invite teammates",
      authorName: "Grace",
      slackUserId: "U_GRACE",
    });
    if (!started.ok) throw new Error(started.error);

    const first = await appendSlackSupportReply({
      integration,
      teamId: integration.teamId,
      channelId: integration.channelId!,
      threadTs: "1700000000.000200",
      messageTs: "1700000000.000201",
      body: "It happens on the settings page.",
    });
    expect(first).toMatchObject({ ok: true, duplicate: false, created: false });

    const retry = await appendSlackSupportReply({
      integration,
      teamId: integration.teamId,
      channelId: integration.channelId!,
      threadTs: "1700000000.000200",
      messageTs: "1700000000.000201",
      body: "It happens on the settings page.",
    });
    expect(retry).toMatchObject({ ok: true, duplicate: true });

    let messages = await db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, started.conversationId));
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({ body: "It happens on the settings page.", channel: "slack" });

    const conversation = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, started.conversationId));
    expect(conversation[0]).toMatchObject({
      unreadForTeam: 2,
      lastMessagePreview: "It happens on the settings page.",
    });

    await db
      .update(conversations)
      .set({ status: "resolved" })
      .where(eq(conversations.id, started.conversationId));

    await appendSlackSupportReply({
      integration,
      teamId: integration.teamId,
      channelId: integration.channelId!,
      threadTs: "1700000000.000200",
      messageTs: "1700000000.000202",
      body: "I still need help.",
    });
    const reopened = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, started.conversationId));
    expect(reopened[0]?.status).toBe("open");
    expect(reopened[0]?.unreadForTeam).toBe(3);

    messages = await db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, started.conversationId));
    expect(messages).toHaveLength(3);
  });

  isolatedTest("never lets a thread from another product be continued", async () => {
    const workspace = await createWorkspace();
    const firstProduct = await createProduct(workspace.id);
    const secondProduct = await createProduct(workspace.id);
    const first = await connectSlack({
      workspaceId: workspace.id,
      productId: firstProduct.id,
    });
    const second = await connectSlack({
      workspaceId: workspace.id,
      productId: secondProduct.id,
    });

    const started = await startSlackSupportThread({
      integration: first,
      teamId: first.teamId,
      channelId: first.channelId!,
      messageTs: "1700000000.000300",
      body: "Private tenant issue",
      authorName: "Linus",
      slackUserId: "U_LINUS",
    });
    if (!started.ok) throw new Error(started.error);

    const crossed = await appendSlackSupportReply({
      integration: second,
      teamId: first.teamId,
      channelId: first.channelId!,
      threadTs: "1700000000.000300",
      messageTs: "1700000000.000301",
      body: "Wrong tenant reply",
    });
    expect(crossed).toBeNull();

    const rows = await db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, started.conversationId));
    expect(rows).toHaveLength(1);
  });

  isolatedTest("queues one idempotent mirror job per team message", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const integration = await connectSlack({
      workspaceId: workspace.id,
      productId: product.id,
    });

    const started = await startSlackSupportThread({
      integration,
      teamId: integration.teamId,
      channelId: integration.channelId!,
      messageTs: "1700000000.000400",
      body: "Where is my invoice?",
      authorName: "Margaret",
      slackUserId: "U_MARGARET",
    });
    if (!started.ok) throw new Error(started.error);

    const messageId = "2f0c2e1b-6f2a-4f0e-9d4a-1c2b3a4d5e70";
    await queueSlackSupportMirror({
      productId: product.id,
      conversationId: started.conversationId,
      messageId,
      body: "Sent it to your email just now.",
    });
    await queueSlackSupportMirror({
      productId: product.id,
      conversationId: started.conversationId,
      messageId,
      body: "Sent it to your email just now.",
    });

    const queued = await db
      .select()
      .from(jobs)
      .where(eq(jobs.type, "slack_support_mirror"));
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      dedupeKey: `slack-support-mirror:${messageId}`,
      payload: {
        teamId: integration.teamId,
        channelId: integration.channelId,
        threadTs: "1700000000.000400",
        text: "Sent it to your email just now.",
      },
    });
  });
});
