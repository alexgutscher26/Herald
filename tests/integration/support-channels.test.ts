import { afterAll, beforeAll, describe, expect } from "bun:test";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { conversationMessages, conversations } from "@/db/schema/conversations";
import { customers } from "@/db/schema/customers";
import { blockedCustomers } from "@/db/schema/feedback-extensions";
import { notificationDeliveries } from "@/db/schema/notifications";
import {
  appendCustomerMessage,
  loadCustomerThread,
  loadCustomerThreads,
  markCustomerConversationRead,
  publicConversationUnreadCount,
  startCustomerConversation,
} from "@/features/conversations/customer";
import { getConversationThread } from "@/features/conversations/queries";
import { appendTeamMessage } from "@/features/conversations/service";
import { createGuestCustomerSession } from "@/features/customer-session/session";
import {
  ensureProductEmailSettings,
  handleInboundEmail,
  readProductEmailSettings,
  saveProductEmailSettings,
} from "@/features/email/inbound";
import {
  conversationReplyAddress,
  productInboundAddress,
} from "@/features/email/inbound-address";
import {
  listOperatorSettings,
  saveOperatorSettings,
  teamPresence,
  touchOperatorPresence,
} from "@/features/operators/service";
import { normalizeEmail } from "@/lib/email";

import {
  createConversation,
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
 * The support channel loop against real Postgres:
 *
 *   widget starts a thread → customer closes the tab → team replies (queued
 *   mail with a reply address) → customer replies by email → the same thread.
 *
 * Also covers the negative paths: junk mail, a paused address, a blocked
 * sender, a sender who does not own the thread, duplicate provider retries and
 * cross-customer reads.
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

async function tenant() {
  const workspace = await createWorkspace({ plan: "pro" });
  const product = await createProduct(workspace.id, { publicFeedbackEnabled: true });
  const owner = await createMember(workspace.id, { role: "owner" });
  return { workspace, product, owner };
}

describe("widget conversations", () => {
  isolatedTest("start, reply, unread and read-state stay on one customer", async () => {
    const { workspace, product, owner } = await tenant();
    const { cookieValue } = await createGuestCustomerSession(workspace.id);
    const slugs = { workspaceSlug: workspace.slug, productSlug: product.slug };

    const started = await startCustomerConversation({
      ...slugs,
      subject: "Export is empty",
      body: "The CSV has no rows.",
      email: "ada@example.test",
      sessionCookie: cookieValue,
    });
    expect(started.state).toBe("ready");
    if (started.state !== "ready") throw new Error("unreachable");

    const list = await loadCustomerThreads({ ...slugs, sessionCookie: cookieValue });
    expect(list.state).toBe("ready");
    if (list.state !== "ready") throw new Error("unreachable");
    expect(list.threads).toHaveLength(1);
    expect(list.email).toBe("ada@example.test");
    expect(list.threads[0]?.unread).toBe(0);

    const reply = await appendCustomerMessage({
      ...slugs,
      conversationId: started.conversationId,
      body: "Any update?",
      sessionCookie: cookieValue,
    });
    expect(reply.state).toBe("ready");

    const teamReply = await appendTeamMessage({
      productId: product.id,
      conversationId: started.conversationId,
      userId: owner.user.id,
      body: "We are looking into it.",
    });
    expect(teamReply.ok).toBe(true);

    const unread = await publicConversationUnreadCount({ ...slugs, sessionCookie: cookieValue });
    expect(unread).toBe(1);

    const thread = await loadCustomerThread({
      ...slugs,
      conversationId: started.conversationId,
      sessionCookie: cookieValue,
    });
    expect(thread.state).toBe("ready");
    if (thread.state !== "ready") throw new Error("unreachable");
    expect(thread.messages.map((message) => message.author)).toEqual([
      "customer",
      "customer",
      "team",
    ]);

    await markCustomerConversationRead({
      ...slugs,
      conversationId: started.conversationId,
      sessionCookie: cookieValue,
    });
    expect(await publicConversationUnreadCount({ ...slugs, sessionCookie: cookieValue })).toBe(0);
  });

  isolatedTest("another customer can neither list nor open the thread", async () => {
    const { workspace, product } = await tenant();
    const slugs = { workspaceSlug: workspace.slug, productSlug: product.slug };

    const first = await createGuestCustomerSession(workspace.id);
    const second = await createGuestCustomerSession(workspace.id);

    const started = await startCustomerConversation({
      ...slugs,
      body: "First customer",
      sessionCookie: first.cookieValue,
    });
    if (started.state !== "ready") throw new Error("unreachable");

    const otherList = await loadCustomerThreads({
      ...slugs,
      sessionCookie: second.cookieValue,
    });
    expect(otherList.state).toBe("ready");
    if (otherList.state === "ready") expect(otherList.threads).toHaveLength(0);

    expect(
      await loadCustomerThread({
        ...slugs,
        conversationId: started.conversationId,
        sessionCookie: second.cookieValue,
      }),
    ).toEqual({ state: "not_found" });

    expect(
      await appendCustomerMessage({
        ...slugs,
        conversationId: started.conversationId,
        body: "Hijack",
        sessionCookie: second.cookieValue,
      }),
    ).toEqual({ state: "not_found" });

    expect(
      await startCustomerConversation({
        ...slugs,
        body: "No session",
        sessionCookie: null,
      }),
    ).toEqual({ state: "signed_out" });
  });
});

describe("end-to-end support loop", () => {
  isolatedTest("a widget thread survives the closed tab and an email round trip", async () => {
    const { workspace, product, owner } = await tenant();
    await ensureProductEmailSettings(product.id);
    const { cookieValue } = await createGuestCustomerSession(workspace.id);
    const slugs = { workspaceSlug: workspace.slug, productSlug: product.slug };

    // The customer starts in the widget and then closes the tab.
    const started = await startCustomerConversation({
      ...slugs,
      subject: "Widget crashes on load",
      body: "The launcher throws before it renders.",
      email: "loop@example.test",
      sessionCookie: cookieValue,
    });
    if (started.state !== "ready") throw new Error("unreachable");

    // The operator answers from the dashboard; that reply is queued as mail.
    const teamReply = await appendTeamMessage({
      productId: product.id,
      conversationId: started.conversationId,
      userId: owner.user.id,
      body: "Which browser and version?",
    });
    expect(teamReply.ok).toBe(true);

    const [conversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, started.conversationId));
    if (!conversation?.replyToken) throw new Error("unreachable");

    const deliveries = await db
      .select()
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.conversationId, started.conversationId),
          eq(notificationDeliveries.template, "conversation_reply"),
        ),
      );
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.recipientEmail).toBe("loop@example.test");

    // The customer replies from their mail client, with no widget session.
    const inbound = await handleInboundEmail({
      to: conversationReplyAddress(conversation.replyToken),
      from: "Loop <LOOP@example.test>",
      subject: "Re: Widget crashes on load",
      text: "Firefox 132, and it still happens after reloading.",
      messageId: "<loop-reply@example.test>",
      headers: {},
    });
    expect(inbound).toMatchObject({
      status: "accepted",
      conversationId: started.conversationId,
    });
    expect(inbound.messageId).toBeTruthy();

    const [after] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, started.conversationId));
    expect(after?.status).toBe("open");
    expect(after?.unreadForTeam).toBe(1);
    expect(after?.lastMessagePreview).toBe(
      "Firefox 132, and it still happens after reloading.",
    );

    // Both sides read the same three messages in the same order.
    const customerThread = await loadCustomerThread({
      ...slugs,
      conversationId: started.conversationId,
      sessionCookie: cookieValue,
    });
    if (customerThread.state !== "ready") throw new Error("unreachable");
    expect(customerThread.messages.map((message) => message.author)).toEqual([
      "customer",
      "team",
      "customer",
    ]);
    expect(customerThread.messages.at(-1)?.body).toBe(
      "Firefox 132, and it still happens after reloading.",
    );

    const teamThread = await getConversationThread({
      productId: product.id,
      conversationId: started.conversationId,
      userId: owner.user.id,
    });
    expect(teamThread?.messages.map((message) => message.authorType)).toEqual([
      "customer",
      "team",
      "customer",
    ]);
    expect(teamThread?.messages.map((message) => message.body)).toEqual(
      customerThread.messages.map((message) => message.body),
    );

    // The customer reopening the widget clears the badge again.
    expect(
      await publicConversationUnreadCount({ ...slugs, sessionCookie: cookieValue }),
    ).toBe(1);
    await markCustomerConversationRead({
      ...slugs,
      conversationId: started.conversationId,
      sessionCookie: cookieValue,
    });
    expect(
      await publicConversationUnreadCount({ ...slugs, sessionCookie: cookieValue }),
    ).toBe(0);
  });
});

describe("inbound email", () => {
  isolatedTest("a new thread is parsed, deduped and reopened by a reply", async () => {
    const { product, owner } = await tenant();
    const settings = await ensureProductEmailSettings(product.id);

    const first = await handleInboundEmail({
      to: `Support <${settings.address}>`,
      from: "Ada <ADA@Example.test>",
      fromName: "Ada",
      subject: "Cannot export",
      text: "The export button does nothing.",
      messageId: "<first@example.test>",
      headers: {},
    });
    expect(first.status).toBe("accepted");
    if (!first.conversationId) throw new Error("unreachable");

    const rows = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, first.conversationId));
    const conversation = rows[0];
    expect(conversation?.subject).toBe("Cannot export");
    expect(conversation?.unreadForTeam).toBe(1);
    expect(conversation?.replyToken).toBeTruthy();

    // The provider retries the same message id: acknowledge, add nothing.
    expect(
      await handleInboundEmail({
        to: settings.address,
        from: "ada@example.test",
        subject: "Cannot export",
        text: "The export button does nothing.",
        messageId: "<first@example.test>",
      }),
    ).toEqual({ status: "ignored", reason: "duplicate" });

    const replyAddress = conversationReplyAddress(conversation?.replyToken ?? "");
    const accepted = await handleInboundEmail({
      to: replyAddress,
      from: "ada@example.test",
      subject: "Re: Cannot export",
      text: "Any news?",
      messageId: "<second@example.test>",
    });
    expect(accepted).toMatchObject({
      status: "accepted",
      conversationId: first.conversationId,
    });

    const after = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, first.conversationId));
    expect(after[0]?.unreadForTeam).toBe(2);

    // Team reply queues exactly one transactional email with the reply address.
    const teamReply = await appendTeamMessage({
      productId: product.id,
      conversationId: first.conversationId,
      userId: owner.user.id,
      body: "Fixed in the next build.",
    });
    expect(teamReply.ok).toBe(true);

    // Operator alerts are separate deliveries; the customer side is exactly
    // one reply mail.
    const deliveries = await db
      .select()
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.conversationId, first.conversationId),
          eq(notificationDeliveries.template, "conversation_reply"),
        ),
      );
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.recipientEmail).toBe("ada@example.test");
    expect(deliveries[0]?.conversationMessageId).toBe(
      teamReply.ok ? teamReply.data.messageId : null,
    );
  });

  isolatedTest("junk, wrong sender, pause and block are all refused", async () => {
    const { workspace, product } = await tenant();
    const settings = await ensureProductEmailSettings(product.id);

    expect(
      await handleInboundEmail({
        to: settings.address,
        from: "ada@example.test",
        subject: "Out of office",
        text: "I am away.",
        headers: { "auto-submitted": "auto-replied" },
      }),
    ).toEqual({ status: "ignored", reason: "auto_reply" });

    const conversation = await createConversation({
      productId: product.id,
      workspaceId: workspace.id,
      customerId: (
        await createCustomer(workspace.id, { email: "ada@example.test" })
      ).id,
    });
    await db
      .update(conversations)
      .set({ replyToken: "replyTokenForTests123" })
      .where(eq(conversations.id, conversation.id));

    expect(
      await handleInboundEmail({
        to: conversationReplyAddress("replyTokenForTests123"),
        from: "ada@example.test",
        subject: "Out of office",
        text: "I am away until Monday.",
        messageId: "<auto-reply@example.test>",
        headers: { "auto-submitted": "auto-replied" },
      }),
    ).toEqual({ status: "ignored", reason: "auto_reply" });
    const autoReplyNotes = await db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversation.id));
    expect(autoReplyNotes).toHaveLength(1);
    expect(autoReplyNotes[0]).toMatchObject({ authorType: "system", kind: "note" });
    expect(autoReplyNotes[0]?.body).toContain("automatic reply");

    expect(
      await handleInboundEmail({
        to: conversationReplyAddress("replyTokenForTests123"),
        from: "mallory@example.test",
        text: "Let me in.",
      }),
    ).toEqual({ status: "rejected", reason: "sender_mismatch" });

    await db.insert(blockedCustomers).values({
      workspaceId: workspace.id,
      customerId: conversation.customerId,
      emailNormalized: "ada@example.test",
      reason: "test",
    });
    expect(
      await handleInboundEmail({
        to: conversationReplyAddress("replyTokenForTests123"),
        from: "ada@example.test",
        text: "Blocked.",
      }),
    ).toEqual({ status: "ignored", reason: "blocked" });

    const paused = await saveProductEmailSettings({
      productId: product.id,
      enabled: false,
      displayName: "Ada's team",
    });
    expect(paused.ok).toBe(true);
    if (paused.ok) expect(paused.address).toBe(settings.address);
    expect((await readProductEmailSettings(product.id))?.displayName).toBe("Ada's team");

    expect(
      await handleInboundEmail({
        to: productInboundAddress(settings.token),
        from: "new@example.test",
        subject: "Hello",
        text: "Anyone there?",
      }),
    ).toEqual({ status: "ignored", reason: "disabled" });

    const rotated = await saveProductEmailSettings({
      productId: product.id,
      enabled: true,
      displayName: "Support",
      regenerate: true,
    });
    expect(rotated.ok).toBe(true);
    if (rotated.ok) expect(rotated.address).not.toBe(settings.address);
  });

  isolatedTest("one sender address stays two separate customers and threads", async () => {
    const a = await tenant();
    const b = await tenant();
    const settingsA = await ensureProductEmailSettings(a.product.id);
    const settingsB = await ensureProductEmailSettings(b.product.id);
    const address = `${uniqueLabel("shared")}@example.test`;

    const first = await handleInboundEmail({
      to: settingsA.address,
      from: address,
      subject: "Workspace A",
      text: "Hello from A",
      messageId: "<shared-a@example.test>",
    });
    const second = await handleInboundEmail({
      to: settingsB.address,
      from: address,
      subject: "Workspace B",
      text: "Hello from B",
      messageId: "<shared-b@example.test>",
    });
    expect(first.status).toBe("accepted");
    expect(second.status).toBe("accepted");
    if (!first.conversationId || !second.conversationId) throw new Error("unreachable");
    expect(first.conversationId).not.toBe(second.conversationId);

    const customerRows = await db
      .select()
      .from(customers)
      .where(eq(customers.emailNormalized, normalizeEmail(address)));
    expect(customerRows).toHaveLength(2);
    expect(new Set(customerRows.map((row) => row.workspaceId)).size).toBe(2);

    expect(
      await getConversationThread({
        productId: b.product.id,
        conversationId: first.conversationId,
        userId: "usr_viewer",
      }),
    ).toBeNull();
  });
});

describe("operators", () => {
  isolatedTest("only owners and admins count, and preferences drive presence", async () => {
    const { workspace } = await tenant();
    const editor = await createMember(workspace.id, { role: "editor" });

    expect(
      await saveOperatorSettings({
        workspaceId: workspace.id,
        userId: editor.user.id,
        timezone: "UTC",
        schedule: null,
        availableWhileUsing: true,
        appearOffline: false,
      }),
    ).toEqual({
      ok: false,
      error: "Only an owner or admin can be a conversation operator.",
    });
    expect(
      await touchOperatorPresence({
        workspaceId: workspace.id,
        userId: editor.user.id,
      }),
    ).toBe(false);

    expect(
      await saveOperatorSettings({
        workspaceId: workspace.id,
        userId: editor.user.id,
        timezone: "Mars/Olympus",
        schedule: null,
        availableWhileUsing: true,
        appearOffline: false,
      }).then((result) => result.ok),
    ).toBe(false);

    const owner = await createMember(workspace.id, { role: "owner" });
    const save = await saveOperatorSettings({
      workspaceId: workspace.id,
      userId: owner.user.id,
      timezone: "UTC",
      schedule: null,
      availableWhileUsing: true,
      appearOffline: false,
    });
    expect(save).toEqual({ ok: true });

    const now = new Date("2026-01-05T12:00:00.000Z");
    expect(
      await touchOperatorPresence({
        workspaceId: workspace.id,
        userId: owner.user.id,
        now,
      }),
    ).toBe(true);
    expect(await teamPresence(workspace.id, now)).toBe(true);

    const visible = await listOperatorSettings(workspace.id);
    const visibleIds = visible.map((operator) => operator.userId);
    expect(visibleIds).toContain(owner.user.id);
    expect(visibleIds).not.toContain(editor.user.id);
    expect(visible.every((operator) => operator.role === "owner")).toBe(true);
    expect(
      visible.find((operator) => operator.userId === owner.user.id)?.operator?.timezone,
    ).toBe("UTC");

    await saveOperatorSettings({
      workspaceId: workspace.id,
      userId: owner.user.id,
      timezone: "UTC",
      schedule: null,
      availableWhileUsing: true,
      appearOffline: true,
    });
    expect(await teamPresence(workspace.id, now)).toBe(false);

    await saveOperatorSettings({
      workspaceId: workspace.id,
      userId: owner.user.id,
      timezone: "UTC",
      schedule: [],
      availableWhileUsing: false,
      appearOffline: false,
    });
    expect(await teamPresence(workspace.id, now)).toBe(false);

    await saveOperatorSettings({
      workspaceId: workspace.id,
      userId: owner.user.id,
      timezone: "UTC",
      schedule: [{ days: [1], start: "09:00", end: "17:00" }],
      availableWhileUsing: false,
      appearOffline: false,
    });
    expect(await teamPresence(workspace.id, now)).toBe(true);

    // Outside the window the same operator is away, even with a fresh
    // heartbeat: availability is the window, not merely recent activity.
    const evening = new Date("2026-01-05T19:00:00.000Z");
    await touchOperatorPresence({
      workspaceId: workspace.id,
      userId: owner.user.id,
      now: evening,
    });
    expect(await teamPresence(workspace.id, evening)).toBe(false);
  });
});
