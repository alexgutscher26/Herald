import { afterAll, beforeAll, describe, expect } from "bun:test";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { conversationMessages } from "@/db/schema/conversations";
import { feedbackComments } from "@/db/schema/feedback";
import {
  feedbackFollowers,
  feedbackInsights,
} from "@/db/schema/feedback-extensions";
import {
  inAppNotifications,
  notificationDeliveries,
} from "@/db/schema/notifications";
import { subscribers } from "@/db/schema/subscribers";
import { createCustomerSession } from "@/features/customer-session/session";
import {
  digestDayKey,
  enqueueDailyDigests,
  enqueueWeeklyDigests,
  weeklyDigestWeekKey,
} from "@/features/notifications/digest";
import {
  loadPublicInbox,
  markPublicNotificationsRead,
  publicUnreadNotificationCount,
} from "@/features/notifications/inbox";
import {
  queueFeedbackReplyNotifications,
  queueFeedbackStatusNotifications,
  queueReleaseInAppNotifications,
} from "@/features/notifications/service";

import { normalizeEmail } from "@/lib/email";

import {
  createBoard,
  createConversation,
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
} from "./harness";

/**
 * Notification loop against real Postgres.
 *
 * The fan-out writes both the outbox and the inbox row in one transaction, so
 * the assertions check the rows a retry would read, not an in-memory mock.
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
  const workspace = await createWorkspace();
  const product = await createProduct(workspace.id, {
    publicFeedbackEnabled: true,
    publicChangelogEnabled: true,
  });
  const board = await createBoard(product.id, { visibility: "public" });
  return { workspace, product, board };
}

describe("feedback status notifications", () => {
  isolatedTest("queues one email and one in-app row, and a replay adds nothing", async () => {
    const t = await tenant();
    const author = await createCustomer(t.workspace.id, {
      email: `${uniqueLabel("author")}@example.test`,
      verifiedAt: new Date(),
    });
    const post = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
      authorCustomerId: author.id,
      title: "Dark mode",
    });
    const eventAt = new Date();

    const first = await db.transaction((tx) =>
      queueFeedbackStatusNotifications(tx, {
        productId: t.product.id,
        postId: post.id,
        toStatus: "in_progress",
        eventAt,
      }),
    );
    expect(first).toEqual({ recipients: 1, emails: 1, inApp: 1 });

    const deliveries = await db
      .select()
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.productId, t.product.id),
          eq(notificationDeliveries.template, "feedback_status_changed"),
        ),
      );
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.recipientEmail).toBe(author.email ?? "");
    expect(deliveries[0]?.feedbackPostId).toBe(post.id);

    const inbox = await db
      .select()
      .from(inAppNotifications)
      .where(eq(inAppNotifications.customerId, author.id));
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.title).toContain("Request updated");
    expect(inbox[0]?.href).toContain(post.id);

    const replay = await db.transaction((tx) =>
      queueFeedbackStatusNotifications(tx, {
        productId: t.product.id,
        postId: post.id,
        toStatus: "in_progress",
        eventAt,
      }),
    );
    expect(replay).toEqual({ recipients: 1, emails: 0, inApp: 0 });
  });

  isolatedTest("adds one internal note to each linked support thread and replays safely", async () => {
    const t = await tenant();
    const author = await createCustomer(t.workspace.id, {
      email: `${uniqueLabel("linked")}@example.test`,
      verifiedAt: new Date(),
    });
    const post = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
      authorCustomerId: author.id,
      title: "Linked request",
    });
    const conversation = await createConversation({
      productId: t.product.id,
      workspaceId: t.workspace.id,
      customerId: author.id,
    });
    await db.insert(feedbackInsights).values({
      productId: t.product.id,
      feedbackPostId: post.id,
      source: "support",
      sourceRef: conversation.id,
      quote: "Please build this.",
      authorCustomerId: author.id,
    });

    const eventAt = new Date();
    await db.transaction((tx) =>
      queueFeedbackStatusNotifications(tx, {
        productId: t.product.id,
        postId: post.id,
        toStatus: "planned",
        eventAt,
      }),
    );
    await db.transaction((tx) =>
      queueFeedbackStatusNotifications(tx, {
        productId: t.product.id,
        postId: post.id,
        toStatus: "planned",
        eventAt,
      }),
    );

    const notes = await db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversation.id));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ authorType: "system", kind: "note", channel: "team" });
    expect(notes[0]?.body).toContain("Linked request");
    expect(notes[0]?.body).toContain("Planned");
  });

  isolatedTest("rapid status changes on one request collapse into one pending email", async () => {
    const t = await tenant();
    const author = await createCustomer(t.workspace.id, {
      email: `${uniqueLabel("batched")}@example.test`,
      verifiedAt: new Date(),
    });
    const post = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
      authorCustomerId: author.id,
      title: "Batch me",
    });

    const start = Date.now();
    let firstEmailCount = 0;
    for (let index = 0; index < 10; index += 1) {
      const summary = await db.transaction((tx) =>
        queueFeedbackStatusNotifications(tx, {
          productId: t.product.id,
          postId: post.id,
          toStatus: index % 2 === 0 ? "planned" : "in_progress",
          eventAt: new Date(start + index * 1000),
        }),
      );
      if (index === 0) firstEmailCount = summary.emails;
    }
    expect(firstEmailCount).toBe(1);

    const emails = await db
      .select({ id: notificationDeliveries.id })
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.productId, t.product.id),
          eq(notificationDeliveries.template, "feedback_status_changed"),
        ),
      );
    expect(emails).toHaveLength(1);

    const inbox = await db
      .select({ id: inAppNotifications.id })
      .from(inAppNotifications)
      .where(eq(inAppNotifications.customerId, author.id));
    expect(inbox).toHaveLength(10);
  });

  isolatedTest("a customer who turned status email off gets neither channel", async () => {
    const t = await tenant();
    const author = await createCustomer(t.workspace.id, {
      email: `${uniqueLabel("quiet")}@example.test`,
      verifiedAt: new Date(),
    });
    const post = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
      authorCustomerId: author.id,
    });

    await db.transaction((tx) =>
      queueFeedbackStatusNotifications(tx, {
        productId: t.product.id,
        postId: post.id,
        toStatus: "planned",
        eventAt: new Date(),
      }),
    );

    await db
      .update(subscribers)
      .set({ notifyStatusChanges: false })
      .where(
        and(
          eq(subscribers.productId, t.product.id),
          eq(subscribers.emailNormalized, author.emailNormalized ?? ""),
        ),
      );

    const summary = await db.transaction((tx) =>
      queueFeedbackStatusNotifications(tx, {
        productId: t.product.id,
        postId: post.id,
        toStatus: "shipped",
        eventAt: new Date(),
      }),
    );
    expect(summary).toEqual({ recipients: 1, emails: 0, inApp: 0 });
  });

  isolatedTest("hidden requests never notify anyone", async () => {
    const t = await tenant();
    const author = await createCustomer(t.workspace.id, {
      email: `${uniqueLabel("hidden")}@example.test`,
      verifiedAt: new Date(),
    });
    const post = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
      authorCustomerId: author.id,
      hiddenAt: new Date(),
    });

    const summary = await db.transaction((tx) =>
      queueFeedbackStatusNotifications(tx, {
        productId: t.product.id,
        postId: post.id,
        toStatus: "planned",
        eventAt: new Date(),
      }),
    );
    expect(summary).toEqual({ recipients: 0, emails: 0, inApp: 0 });
  });
});

describe("release notifications", () => {
  isolatedTest("page subscribers and linked-request followers get one in-app row each", async () => {
    const t = await tenant();
    const release = await createRelease({ productId: t.product.id });

    const subscriberCustomer = await createCustomer(t.workspace.id, {
      email: `${uniqueLabel("release-sub")}@example.test`,
      verifiedAt: new Date(),
    });
    await db.insert(subscribers).values({
      productId: t.product.id,
      email: subscriberCustomer.email ?? "",
      emailNormalized: subscriberCustomer.emailNormalized ?? "",
      status: "active",
      source: "manual",
    });

    const follower = await createCustomer(t.workspace.id, {
      email: `${uniqueLabel("release-follower")}@example.test`,
      verifiedAt: new Date(),
    });
    const post = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
    });
    await createReleaseFeedbackLink({
      productId: t.product.id,
      releaseId: release.id,
      feedbackPostId: post.id,
    });
    await db.insert(feedbackFollowers).values({
      feedbackPostId: post.id,
      customerId: follower.id,
      source: "board",
    });

    const first = await db.transaction((tx) =>
      queueReleaseInAppNotifications(tx, {
        workspaceId: t.workspace.id,
        productId: t.product.id,
        releaseId: release.id,
      }),
    );
    expect(first).toBe(2);

    const rows = await db
      .select()
      .from(inAppNotifications)
      .where(eq(inAppNotifications.releaseId, release.id));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.customerId))).toEqual(
      new Set([subscriberCustomer.id, follower.id]),
    );
    expect(rows.every((row) => row.href.includes("/updates/"))).toBe(true);

    const replay = await db.transaction((tx) =>
      queueReleaseInAppNotifications(tx, {
        workspaceId: t.workspace.id,
        productId: t.product.id,
        releaseId: release.id,
      }),
    );
    expect(replay).toBe(0);
  });
});

describe("feedback reply notifications", () => {
  isolatedTest("notifies the author and skips the customer who replied", async () => {
    const t = await tenant();
    const author = await createCustomer(t.workspace.id, {
      email: `${uniqueLabel("reply-author")}@example.test`,
      verifiedAt: new Date(),
    });
    const other = await createCustomer(t.workspace.id, {
      email: `${uniqueLabel("reply-other")}@example.test`,
      verifiedAt: new Date(),
    });
    const post = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
      authorCustomerId: author.id,
    });
    const comment = await db
      .insert(feedbackComments)
      .values({
        productId: t.product.id,
        feedbackPostId: post.id,
        authorName: "Team",
        authorType: "team",
        body: "We are on it.",
      })
      .returning({ id: feedbackComments.id });

    const summary = await db.transaction((tx) =>
      queueFeedbackReplyNotifications(tx, {
        productId: t.product.id,
        postId: post.id,
        commentId: comment[0]?.id ?? "",
        authorName: "Team",
        body: "We are on it.",
        eventAt: new Date(),
        authorCustomerId: other.id,
      }),
    );
    expect(summary).toEqual({ recipients: 1, emails: 1, inApp: 1 });

    const inbox = await db
      .select()
      .from(inAppNotifications)
      .where(eq(inAppNotifications.customerId, author.id));
    expect(inbox[0]?.kind).toBe("feedback_reply");
    expect(inbox[0]?.body).toContain("Team:");
  });
});

describe("weekly digest", () => {
  isolatedTest("queues one digest per opted-in subscriber and replays safely", async () => {
    const t = await tenant();
    await createRelease({
      productId: t.product.id,
      title: "Weekly release",
      publishedAt: new Date("2026-01-07T12:00:00.000Z"),
    });

    const optedIn = `${uniqueLabel("digest")}@example.test`;
    const optedOut = `${uniqueLabel("no-digest")}@example.test`;
    await db.insert(subscribers).values([
      {
        productId: t.product.id,
        email: optedIn,
        emailNormalized: normalizeEmail(optedIn),
        status: "active",
        source: "manual",
        weeklyDigest: true,
      },
      {
        productId: t.product.id,
        email: optedOut,
        emailNormalized: normalizeEmail(optedOut),
        status: "active",
        source: "manual",
        weeklyDigest: false,
      },
    ]);

    const now = new Date("2026-01-08T12:00:00.000Z");
    const first = await enqueueWeeklyDigests({ now });
    expect(first.weekKey).toBe("2026-01-05");
    expect(first.queued).toBe(1);
    expect(first.products).toContain(t.product.id);

    const rows = await db
      .select()
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.productId, t.product.id),
          eq(notificationDeliveries.template, "weekly_digest"),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.recipientEmail).toBe(optedIn);
    expect(rows[0]?.dedupeKey).toContain("2026-01-05");

    const second = await enqueueWeeklyDigests({ now });
    expect(second.queued).toBe(0);
  });

  isolatedTest("skips a product with no public release in the window", async () => {
    const t = await tenant();
    const email = `${uniqueLabel("digest-empty")}@example.test`;
    await db.insert(subscribers).values({
      productId: t.product.id,
      email,
      emailNormalized: normalizeEmail(email),
      status: "active",
      source: "manual",
      weeklyDigest: true,
    });

    const summary = await enqueueWeeklyDigests({
      now: new Date("2026-01-08T12:00:00.000Z"),
    });
    expect(summary.queued).toBe(0);
    expect(summary.emptyProducts).toContain(t.product.id);
  });

  isolatedTest("a Monday belongs to that Monday's ISO week", async () => {
    expect(weeklyDigestWeekKey(new Date("2026-01-05T00:00:00.000Z"))).toBe("2026-01-05");
    expect(weeklyDigestWeekKey(new Date("2026-01-11T23:59:59.000Z"))).toBe("2026-01-05");
  });

  isolatedTest("queues a daily digest for a daily subscriber only", async () => {
    const t = await tenant();
    await createRelease({
      productId: t.product.id,
      title: "Daily release",
      publishedAt: new Date("2026-01-08T08:00:00.000Z"),
    });

    const daily = `${uniqueLabel("daily")}@example.test`;
    const weekly = `${uniqueLabel("weekly")}@example.test`;
    await db.insert(subscribers).values([
      {
        productId: t.product.id,
        email: daily,
        emailNormalized: normalizeEmail(daily),
        status: "active",
        source: "manual",
        weeklyDigest: true,
        digestFrequency: "daily",
      },
      {
        productId: t.product.id,
        email: weekly,
        emailNormalized: normalizeEmail(weekly),
        status: "active",
        source: "manual",
        weeklyDigest: true,
        digestFrequency: "weekly",
      },
    ]);

    const now = new Date("2026-01-08T12:00:00.000Z");
    const summary = await enqueueDailyDigests({ now });
    expect(summary.queued).toBe(1);
    expect(summary.sourceKey).toBe(digestDayKey(now));

    const rows = await db
      .select()
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.productId, t.product.id),
          eq(notificationDeliveries.template, "daily_digest"),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.recipientEmail).toBe(daily);
  });
});

describe("public inbox", () => {
  isolatedTest("reads, scopes and marks the signed-in customer's rows", async () => {
    const t = await tenant();
    const customer = await createCustomer(t.workspace.id, {
      email: `${uniqueLabel("inbox")}@example.test`,
      verifiedAt: new Date(),
    });
    const session = await createCustomerSession({
      workspaceId: t.workspace.id,
      customerId: customer.id,
    });
    if (!session) throw new Error("Could not create an identified session.");

    const post = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
      authorCustomerId: customer.id,
    });
    const otherCustomer = await createCustomer(t.workspace.id, {
      email: `${uniqueLabel("inbox-other")}@example.test`,
      verifiedAt: new Date(),
    });
    await db.insert(inAppNotifications).values({
      workspaceId: t.workspace.id,
      productId: t.product.id,
      customerId: otherCustomer.id,
      kind: "feedback_status_changed",
      title: "Someone else's row",
      body: "Must not appear in this inbox.",
      href: `/p/${t.workspace.slug}/${t.product.slug}/${t.board.slug}/${post.id}`,
      dedupeKey: `test:other:${post.id}`,
      feedbackPostId: post.id,
    });
    await db.insert(inAppNotifications).values([
      {
        workspaceId: t.workspace.id,
        productId: t.product.id,
        customerId: customer.id,
        kind: "feedback_status_changed",
        title: "Request updated",
        body: "It is in progress.",
        href: `/p/${t.workspace.slug}/${t.product.slug}/${t.board.slug}/${post.id}`,
        dedupeKey: `test:unread:${post.id}`,
        feedbackPostId: post.id,
      },
      {
        workspaceId: t.workspace.id,
        productId: t.product.id,
        customerId: customer.id,
        kind: "feedback_reply",
        title: "New reply",
        body: "A reply.",
        href: `/p/${t.workspace.slug}/${t.product.slug}/${t.board.slug}/${post.id}`,
        dedupeKey: `test:read:${post.id}`,
        feedbackPostId: post.id,
        readAt: new Date(),
      },
    ]);

    const inbox = await loadPublicInbox({
      workspaceSlug: t.workspace.slug,
      productSlug: t.product.slug,
      sessionCookie: session.cookieValue,
    });
    expect(inbox.state).toBe("ready");
    if (inbox.state !== "ready") return;
    expect(inbox.items).toHaveLength(2);
    expect(inbox.unread).toBe(1);
    expect(inbox.items.filter((item) => !item.read)).toHaveLength(1);

    expect(
      await publicUnreadNotificationCount({
        workspaceSlug: t.workspace.slug,
        productSlug: t.product.slug,
        sessionCookie: session.cookieValue,
      }),
    ).toBe(1);

    const marked = await markPublicNotificationsRead({
      workspaceSlug: t.workspace.slug,
      productSlug: t.product.slug,
      sessionCookie: session.cookieValue,
    });
    expect(marked).toEqual({ marked: 1, signedIn: true });

    const after = await loadPublicInbox({
      workspaceSlug: t.workspace.slug,
      productSlug: t.product.slug,
      sessionCookie: session.cookieValue,
    });
    expect(after.state).toBe("ready");
    if (after.state === "ready") expect(after.unread).toBe(0);

    const otherRows = await db
      .select()
      .from(inAppNotifications)
      .where(eq(inAppNotifications.customerId, otherCustomer.id));
    expect(otherRows[0]?.readAt).toBeNull();

    const anotherWorkspace = await createWorkspace();
    expect(
      await loadPublicInbox({
        workspaceSlug: anotherWorkspace.slug,
        productSlug: t.product.slug,
        sessionCookie: session.cookieValue,
      }).then((value) => value.state),
    ).toBe("not_found");
  });

  isolatedTest("without a session the inbox asks the visitor to sign in", async () => {
    const t = await tenant();
    const inbox = await loadPublicInbox({
      workspaceSlug: t.workspace.slug,
      productSlug: t.product.slug,
      sessionCookie: null,
    });

    expect(inbox.state).toBe("signed_out");
    expect(
      await publicUnreadNotificationCount({
        workspaceSlug: t.workspace.slug,
        productSlug: t.product.slug,
        sessionCookie: null,
      }),
    ).toBe(0);
  });
});
