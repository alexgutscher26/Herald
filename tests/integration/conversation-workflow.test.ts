import { afterAll, beforeAll, describe, expect } from "bun:test";

import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";

import { POST as startConversationRoute } from "@/app/api/public/conversations/route";
import { db } from "@/db";
import { customers } from "@/db/schema/customers";
import {
  conversationDrafts,
  conversationMessages,
  conversationNotifications,
  conversations,
} from "@/db/schema/conversations";
import { feedbackComments } from "@/db/schema/feedback";
import { feedbackCustomerVotes } from "@/db/schema/feedback-extensions";
import { notificationDeliveries } from "@/db/schema/notifications";
import {
  appendCustomerMessage,
  loadCustomerThread,
  startCustomerConversation,
} from "@/features/conversations/customer";
import { queueCustomerMessageNotifications } from "@/features/conversations/notify";
import {
  getConversationThread,
  listConversationNotifications,
  markConversationNotificationsRead,
} from "@/features/conversations/queries";
import {
  appendTeamMessage,
  saveConversationDraft,
} from "@/features/conversations/service";
import { createGuestCustomerSession } from "@/features/customer-session/session";
import { ensureProductEmailSettings } from "@/features/email/inbound";
import {
  saveOperatorSettings,
  touchOperatorPresence,
} from "@/features/operators/service";
import { getServerEnv } from "@/lib/env";

import {
  createBoard,
  createConversation,
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

/**
 * The conversation workflow against real Postgres: who is told about a
 * customer message, what an away reply does once and when it resumes, whether
 * a draft follows one operator or leaks to the team, and what visitor context
 * reaches the thread.
 */

let previous: Record<string, string | undefined> = {};
let origin: string;

beforeAll(async () => {
  previous = {
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  };
  process.env.BETTER_AUTH_URL ??= "http://app.local";
  process.env.BETTER_AUTH_SECRET ??= "integration-secret-value-at-least-32-chars";
  await setupTestDatabase();
  origin = new URL(getServerEnv().BETTER_AUTH_URL).origin;
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

type OperatorOverrides = Partial<{
  appearOffline: boolean;
  notifyEmail: boolean;
  notifyInApp: boolean;
  notifyNewConversations: boolean;
  notifyReplies: boolean;
  awayReplyEnabled: boolean;
  awayReplyBody: string;
}>;

async function configure(
  workspaceId: string,
  userId: string,
  overrides: OperatorOverrides = {},
) {
  const result = await saveOperatorSettings({
    workspaceId,
    userId,
    timezone: "UTC",
    schedule: null,
    availableWhileUsing: true,
    appearOffline: false,
    ...overrides,
  });
  if (!result.ok) throw new Error(result.error);
}

function slugs(workspaceSlug: string, productSlug: string) {
  return { workspaceSlug, productSlug };
}

async function systemMessages(conversationId: string) {
  return db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, conversationId));
}

describe("conversation notifications", () => {
  isolatedTest(
    "operator preferences decide who hears about a new conversation and where",
    async () => {
      const { workspace, product, owner } = await tenant();
      const admin = await createMember(workspace.id, { role: "admin" });
      const editor = await createMember(workspace.id, { role: "editor" });

      await configure(workspace.id, owner.user.id);
      await configure(workspace.id, admin.user.id, { notifyInApp: false });

      const { cookieValue } = await createGuestCustomerSession(workspace.id);
      const started = await startCustomerConversation({
        ...slugs(workspace.slug, product.slug),
        subject: "Export is empty",
        body: "The CSV has no rows.",
        email: "ada@example.test",
        sessionCookie: cookieValue,
      });
      expect(started.state).toBe("ready");
      if (started.state !== "ready") throw new Error("unreachable");

      const notices = await db
        .select()
        .from(conversationNotifications)
        .where(
          eq(conversationNotifications.conversationId, started.conversationId),
        );
      // The editor is not an operator; the admin turned the in-app alert off.
      expect(notices.map((notice) => notice.userId)).toEqual([owner.user.id]);
      expect(notices[0]).toMatchObject({
        kind: "new_conversation",
        body: "The CSV has no rows.",
      });
      expect(notices[0]?.title.startsWith("New conversation from ")).toBe(true);

      const deliveries = await db
        .select()
        .from(notificationDeliveries)
        .where(
          eq(
            notificationDeliveries.conversationId,
            started.conversationId,
          ),
        );
      const alerts = deliveries.filter(
        (delivery) => delivery.template === "conversation_notification",
      );
      expect(alerts.map((alert) => alert.recipientEmail).sort()).toEqual(
        [owner.user.email, admin.user.email].sort(),
      );

      expect(
        await listConversationNotifications({
          productId: product.id,
          userId: owner.user.id,
        }),
      ).toHaveLength(1);
      expect(
        await listConversationNotifications({
          productId: product.id,
          userId: editor.user.id,
        }),
      ).toEqual([]);

      await markConversationNotificationsRead({
        productId: product.id,
        userId: owner.user.id,
      });
      expect(
        await listConversationNotifications({
          productId: product.id,
          userId: owner.user.id,
        }),
      ).toEqual([]);
      // Another operator's alert is untouched by that read.
      expect(
        await db
          .select({ id: conversationNotifications.id })
          .from(conversationNotifications)
          .where(eq(conversationNotifications.userId, admin.user.id)),
      ).toHaveLength(0);
    },
  );

  isolatedTest(
    "reply-only operators hear about a reply once, even when the queue retries",
    async () => {
      const { workspace, product, owner } = await tenant();
      await configure(workspace.id, owner.user.id, {
        notifyNewConversations: false,
        notifyReplies: true,
      });

      const { cookieValue } = await createGuestCustomerSession(workspace.id);
      const started = await startCustomerConversation({
        ...slugs(workspace.slug, product.slug),
        subject: "Where is my export?",
        body: "Still waiting.",
        sessionCookie: cookieValue,
      });
      if (started.state !== "ready") throw new Error("unreachable");

      // New conversations are switched off, so the start is silent.
      expect(
        await db
          .select({ id: conversationNotifications.id })
          .from(conversationNotifications)
          .where(
            eq(conversationNotifications.conversationId, started.conversationId),
          ),
      ).toHaveLength(0);

      const replied = await appendCustomerMessage({
        ...slugs(workspace.slug, product.slug),
        conversationId: started.conversationId,
        body: "Any update?",
        sessionCookie: cookieValue,
      });
      expect(replied.state).toBe("ready");

      const notices = await db
        .select()
        .from(conversationNotifications)
        .where(
          eq(conversationNotifications.conversationId, started.conversationId),
        );
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({ kind: "reply", userId: owner.user.id });

      const rows = await systemMessages(started.conversationId);
      const customerMessage = rows.at(-1);
      if (!customerMessage) throw new Error("unreachable");
      const subject = (
        await db
          .select({ subject: conversations.subject })
          .from(conversations)
          .where(eq(conversations.id, started.conversationId))
      )[0]?.subject;
      if (!subject) throw new Error("unreachable");

      // Replaying the same message (an ingestion retry) inserts nothing.
      const replayed = await db.transaction((tx) =>
        queueCustomerMessageNotifications(tx, {
          workspaceId: workspace.id,
          productId: product.id,
          conversationId: started.conversationId,
          messageId: customerMessage.id,
          subject,
          body: customerMessage.body,
          customerName: "Ada",
          kind: "reply",
          now: new Date(),
        }),
      );
      expect(replayed).toBe(0);
      expect(
        await db
          .select({ id: conversationNotifications.id })
          .from(conversationNotifications)
          .where(
            eq(conversationNotifications.conversationId, started.conversationId),
          ),
      ).toHaveLength(1);
    },
  );
});

describe("away replies", () => {
  isolatedTest(
    "an away reply is sent once per away period, reaches the customer and resumes after a human reply",
    async () => {
      const { workspace, product, owner } = await tenant();
      await ensureProductEmailSettings(product.id);
      await configure(workspace.id, owner.user.id, {
        appearOffline: true,
        awayReplyEnabled: true,
        awayReplyBody: "We are away until Monday.",
      });

      const { cookieValue } = await createGuestCustomerSession(workspace.id);
      const started = await startCustomerConversation({
        ...slugs(workspace.slug, product.slug),
        subject: "Checkout breaks",
        body: "The pay button does nothing.",
        email: "ada@example.test",
        sessionCookie: cookieValue,
      });
      if (started.state !== "ready") throw new Error("unreachable");
      const id = started.conversationId;
      const conversationSlugs = slugs(workspace.slug, product.slug);

      const [stored] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, id));
      expect(stored?.awayReplySentAt).not.toBeNull();

      const rows = await systemMessages(id);
      const away = rows.filter((row) => row.authorType === "system");
      expect(away).toHaveLength(1);
      expect(away[0]).toMatchObject({
        body: "We are away until Monday.",
        channel: "team",
        kind: "message",
      });

      const deliveries = await db
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.conversationId, id));
      const awayEmail = deliveries.filter(
        (delivery) => delivery.template === "conversation_away_reply",
      );
      expect(awayEmail).toHaveLength(1);
      expect(awayEmail[0]?.recipientEmail).toBe("ada@example.test");

      const customerView = await loadCustomerThread({
        ...conversationSlugs,
        conversationId: id,
        sessionCookie: cookieValue,
      });
      if (customerView.state !== "ready") throw new Error("unreachable");
      expect(
        customerView.messages
          .filter((message) => message.author === "team")
          .map((message) => message.body),
      ).toEqual(["We are away until Monday."]);

      // A second customer message during the same away period stays quiet.
      await appendCustomerMessage({
        ...conversationSlugs,
        conversationId: id,
        body: "Still broken.",
        sessionCookie: cookieValue,
      });
      expect(
        (await systemMessages(id)).filter((row) => row.authorType === "system"),
      ).toHaveLength(1);

      const reply = await appendTeamMessage({
        productId: product.id,
        conversationId: id,
        userId: owner.user.id,
        body: "We are back and looking at it.",
      });
      expect(reply.ok).toBe(true);

      const [cleared] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, id));
      expect(cleared?.awayReplySentAt).toBeNull();

      await appendCustomerMessage({
        ...conversationSlugs,
        conversationId: id,
        body: "Thanks.",
        sessionCookie: cookieValue,
      });
      const resumed = (await systemMessages(id)).filter(
        (row) => row.authorType === "system",
      );
      expect(resumed).toHaveLength(2);
      expect(resumed[1]?.body).toBe("We are away until Monday.");
    },
  );

  isolatedTest(
    "an available team or a disabled toggle never sends an away reply",
    async () => {
      const online = await tenant();
      await ensureProductEmailSettings(online.product.id);
      await configure(online.workspace.id, online.owner.user.id, {
        awayReplyEnabled: true,
        awayReplyBody: "We are away.",
      });
      await touchOperatorPresence({
        workspaceId: online.workspace.id,
        userId: online.owner.user.id,
      });

      const onlineSession = await createGuestCustomerSession(online.workspace.id);
      const onlineStarted = await startCustomerConversation({
        ...slugs(online.workspace.slug, online.product.slug),
        body: "Anyone there?",
        sessionCookie: onlineSession.cookieValue,
      });
      if (onlineStarted.state !== "ready") throw new Error("unreachable");
      expect(
        (await systemMessages(onlineStarted.conversationId)).filter(
          (row) => row.authorType === "system",
        ),
      ).toHaveLength(0);

      const away = await tenant();
      await ensureProductEmailSettings(away.product.id);
      await configure(away.workspace.id, away.owner.user.id, {
        appearOffline: true,
        awayReplyEnabled: false,
      });

      const awaySession = await createGuestCustomerSession(away.workspace.id);
      const awayStarted = await startCustomerConversation({
        ...slugs(away.workspace.slug, away.product.slug),
        body: "Anyone there?",
        sessionCookie: awaySession.cookieValue,
      });
      if (awayStarted.state !== "ready") throw new Error("unreachable");
      expect(
        (await systemMessages(awayStarted.conversationId)).filter(
          (row) => row.authorType === "system",
        ),
      ).toHaveLength(0);
    },
  );
});

describe("conversation drafts", () => {
  isolatedTest(
    "a draft is personal, keeps only the latest value and is consumed by a send",
    async () => {
      const { workspace, product, owner } = await tenant();
      const other = await createMember(workspace.id, { role: "admin" });
      const customer = await createCustomer(workspace.id, {
        email: "draft@example.test",
      });
      const conversation = await createConversation({
        workspaceId: workspace.id,
        productId: product.id,
        customerId: customer.id,
      });

      const base = {
        productId: product.id,
        conversationId: conversation.id,
      };

      expect(
        await saveConversationDraft({
          ...base,
          userId: owner.user.id,
          body: "First draft",
        }),
      ).toEqual({ ok: true, data: { saved: true } });

      // The same operator saving again replaces the value.
      await saveConversationDraft({
        ...base,
        userId: owner.user.id,
        body: "Updated draft",
      });
      // A second operator gets their own row.
      await saveConversationDraft({
        ...base,
        userId: other.user.id,
        body: "Someone else's draft",
      });

      expect(
        (
          await getConversationThread({
            ...base,
            userId: owner.user.id,
          })
        )?.draft,
      ).toBe("Updated draft");
      expect(
        (
          await getConversationThread({
            ...base,
            userId: other.user.id,
          })
        )?.draft,
      ).toBe("Someone else's draft");
      expect(
        await db
          .select()
          .from(conversationDrafts)
          .where(eq(conversationDrafts.conversationId, conversation.id)),
      ).toHaveLength(2);

      const sent = await appendTeamMessage({
        productId: product.id,
        conversationId: conversation.id,
        userId: owner.user.id,
        body: "Sending this now.",
      });
      expect(sent.ok).toBe(true);

      expect(
        (
          await getConversationThread({
            ...base,
            userId: owner.user.id,
          })
        )?.draft,
      ).toBe("");
      expect(
        (
          await getConversationThread({
            ...base,
            userId: other.user.id,
          })
        )?.draft,
      ).toBe("Someone else's draft");

      // Clearing the composer removes the row instead of storing spaces.
      expect(
        await saveConversationDraft({
          ...base,
          userId: other.user.id,
          body: "   ",
        }),
      ).toEqual({ ok: true, data: { saved: false } });
      expect(
        await db
          .select()
          .from(conversationDrafts)
          .where(eq(conversationDrafts.conversationId, conversation.id)),
      ).toHaveLength(0);

      const foreign = await tenant();
      expect(
        (
          await saveConversationDraft({
            productId: foreign.product.id,
            conversationId: conversation.id,
            userId: owner.user.id,
            body: "Cross-tenant draft",
          })
        ).ok,
      ).toBe(false);
    },
  );
});

describe("visitor context", () => {
  isolatedTest(
    "the start route records safe context and the thread links the customer's requests",
    async () => {
      const { workspace, product, owner } = await tenant();

      const request = new NextRequest(
        `${origin}/api/public/conversations`,
        {
          method: "POST",
          headers: {
            origin,
            "content-type": "application/json",
            "user-agent": `Mozilla/5.0 ${"a".repeat(600)}`,
            "accept-language": "de-DE,de;q=0.9",
          },
          body: JSON.stringify({
            workspaceSlug: workspace.slug,
            productSlug: product.slug,
            subject: "Checkout fails",
            body: "The pay button does nothing.",
            email: "ada@example.test",
            sourceUrl: "https://shop.example.test/checkout?step=2",
            timezone: "Europe/Berlin",
          }),
        },
      );

      const response = await startConversationRoute(request);
      expect(response.status).toBe(201);
      const payload = (await response.json()) as { conversationId: string };

      const thread = await getConversationThread({
        productId: product.id,
        conversationId: payload.conversationId,
        userId: owner.user.id,
      });
      expect(thread).not.toBeNull();
      if (!thread) return;

      expect(thread.conversation.sourceUrl).toBe(
        "https://shop.example.test/checkout?step=2",
      );
      expect(thread.conversation.sourceContext).toMatchObject({
        channel: "widget",
        referrer: "https://shop.example.test/checkout?step=2",
        locale: "de-DE,de;q=0.9",
        timezone: "Europe/Berlin",
      });
      expect(thread.conversation.sourceContext?.userAgent?.length).toBe(500);
      expect(thread.customer.verifiedAt).toBeNull();
      expect(thread.linkedRequests).toEqual([]);
      expect(thread.customer.activity).toEqual({ posts: 0, comments: 0, votes: 0 });

      const board = await createBoard(product.id);
      const first = await createFeedbackPost({
        productId: product.id,
        boardId: board.id,
        title: "Dark mode",
        authorCustomerId: thread.customer.id,
      });
      const second = await createFeedbackPost({
        productId: product.id,
        boardId: board.id,
        title: "CSV export",
        authorCustomerId: thread.customer.id,
      });
      await createFeedbackPost({
        productId: product.id,
        boardId: board.id,
        title: "Someone else's idea",
      });

      await db.insert(feedbackComments).values([
        {
          productId: product.id,
          feedbackPostId: first.id,
          authorCustomerId: thread.customer.id,
          authorName: "Ada",
          authorType: "customer",
          body: "More detail.",
        },
        {
          productId: product.id,
          feedbackPostId: first.id,
          authorCustomerId: thread.customer.id,
          authorName: "Ada",
          authorType: "customer",
          body: "An internal note.",
          internal: true,
        },
      ]);
      await db.insert(feedbackCustomerVotes).values({
        feedbackPostId: second.id,
        customerId: thread.customer.id,
      });

      const withHistory = await getConversationThread({
        productId: product.id,
        conversationId: payload.conversationId,
        userId: owner.user.id,
      });
      expect(withHistory?.customer.activity).toEqual({
        posts: 2,
        comments: 1,
        votes: 1,
      });
      expect(
        withHistory?.linkedRequests.map((linked) => linked.title).sort(),
      ).toEqual(["CSV export", "Dark mode"]);
      expect(withHistory?.linkedRequests.every(
        (linked) => linked.boardSlug === board.slug,
      )).toBe(true);

      // A verified customer loses the unverified badge in the thread.
      await db
        .update(customers)
        .set({ verifiedAt: new Date("2026-11-04T12:00:00.000Z") })
        .where(eq(customers.id, thread.customer.id));

      const verified = await getConversationThread({
        productId: product.id,
        conversationId: payload.conversationId,
        userId: owner.user.id,
      });
      expect(verified?.customer.verifiedAt).toBe("2026-11-04T12:00:00.000Z");
    },
  );
});
