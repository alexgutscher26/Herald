import { afterAll, beforeAll, describe, expect } from "bun:test";

import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";

import {
  GET as readPreferences,
  POST as savePreferences,
} from "@/app/api/public/email-preferences/route";

import { db } from "@/db";
import {
  boardTags,
  feedbackComments,
  feedbackCustomerVotes,
  feedbackFollowers,
  feedbackMerges,
  feedbackPosts,
  feedbackReactions,
  feedbackTagLinks,
  feedbackVotes,
  subscribers,
} from "@/db/schema";
import type { BoardSettings } from "@/db/schema/boards";
import { mergeFeedbackRequests, unmergeFeedbackRequest } from "@/features/feedback/merge";
import { createTag, deleteTag, replacePostTags } from "@/features/feedback/tags";
import { setCustomerBan } from "@/features/moderation/service";
import { setCustomerVote } from "@/features/public/engagement";
import { parsePublicBoardQuery } from "@/features/public/query";
import { getPublicBoardPage, getPublicRequestPage } from "@/features/public/queries";
import { resolvePublicBoard } from "@/features/public/resolver";
import {
  createGuestCustomerSession,
  findActiveCustomerSession,
} from "@/features/customer-session/session";
import {
  createPreferenceToken,
  getSubscriberPreferences,
  updateSubscriberPreferences,
} from "@/features/subscribers/preferences";
import { normalizeEmail } from "@/lib/email";
import { getServerEnv } from "@/lib/env";

import {
  createBoard,
  createBoardTag,
  createCustomer,
  createFeedbackComment,
  createFeedbackPost,
  createFeedbackVote,
  createProduct,
  createUser,
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
 * Merge, visibility, tags and preference contracts.
 *
 * These are the operations that can silently corrupt counts or leak hidden
 * content, so each one is exercised against real Postgres and read back through
 * the same public projections visitors use.
 */

let previous: Record<string, string | undefined> = {};

beforeAll(async () => {
  previous = {
    FLAG_PUBLIC_FEEDBACK: process.env.FLAG_PUBLIC_FEEDBACK,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  };
  process.env.FLAG_PUBLIC_FEEDBACK = "on";
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

async function tenant(options?: { settings?: BoardSettings; guestPosting?: boolean }) {
  const workspace = await createWorkspace();
  const product = await createProduct(workspace.id);
  const board = await createBoard(product.id, {
    slug: "feedback",
    name: "Feedback",
    guestPosting: options?.guestPosting ?? true,
    ...(options?.settings ? { settings: options.settings } : {}),
  });
  return { workspace, product, board };
}

describe("merge", () => {
  isolatedTest("moves comments, votes, reactions, followers and tags", async () => {
    const t = await tenant();
    const source = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
      title: "Source duplicate",
    });
    const target = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
      title: "Canonical request",
    });

    const teamVoter = await createUser();
    const otherTeamVoter = await createUser();
    await createFeedbackVote({ feedbackPostId: source.id, voterId: teamVoter.id });
    await createFeedbackVote({ feedbackPostId: source.id, voterId: otherTeamVoter.id });
    await createFeedbackVote({ feedbackPostId: target.id, voterId: teamVoter.id });

    const customerA = await createCustomer(t.workspace.id, {
      email: `${uniqueLabel("a")}@example.test`,
      verifiedAt: new Date(),
    });
    const customerB = await createCustomer(t.workspace.id, {
      email: `${uniqueLabel("b")}@example.test`,
      verifiedAt: new Date(),
    });
    await db.insert(feedbackCustomerVotes).values([
      { feedbackPostId: source.id, customerId: customerA.id },
      { feedbackPostId: target.id, customerId: customerA.id },
      { feedbackPostId: source.id, customerId: customerB.id },
    ]);
    await db.insert(feedbackReactions).values([
      { feedbackPostId: source.id, customerId: customerA.id, kind: "like" },
      { feedbackPostId: target.id, customerId: customerA.id, kind: "like" },
      { feedbackPostId: source.id, customerId: customerB.id, kind: "love" },
    ]);
    await db.insert(feedbackFollowers).values([
      { feedbackPostId: source.id, customerId: customerA.id },
      { feedbackPostId: target.id, customerId: customerA.id },
      { feedbackPostId: source.id, customerId: customerB.id },
    ]);

    const comment = await createFeedbackComment({
      productId: t.product.id,
      feedbackPostId: source.id,
      body: "Moves with the merge.",
    });

    await createBoardTag(t.board.id, t.product.id, { name: "only-source" });
    await createBoardTag(t.board.id, t.product.id, { name: "both" });
    const tagRows = await db
      .select({ id: boardTags.id, name: boardTags.name })
      .from(boardTags)
      .where(eq(boardTags.boardId, t.board.id));
    const sourceOnlyTag = tagRows.find((tag) => tag.name === "only-source");
    const bothTag = tagRows.find((tag) => tag.name === "both");
    if (!sourceOnlyTag || !bothTag) throw new Error("Tags were not created.");

    await db.insert(feedbackTagLinks).values([
      { productId: t.product.id, feedbackPostId: source.id, tagId: sourceOnlyTag.id },
      { productId: t.product.id, feedbackPostId: source.id, tagId: bothTag.id },
      { productId: t.product.id, feedbackPostId: target.id, tagId: bothTag.id },
    ]);

    const result = await mergeFeedbackRequests({
      productId: t.product.id,
      sourceId: source.id,
      targetId: target.id,
      userId: teamVoter.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const merged = await db
      .select({ status: feedbackPosts.status, mergedIntoId: feedbackPosts.mergedIntoId })
      .from(feedbackPosts)
      .where(eq(feedbackPosts.id, source.id));
    expect(merged[0]).toEqual({ status: "closed", mergedIntoId: target.id });

    const movedComments = await db
      .select({ postId: feedbackComments.feedbackPostId })
      .from(feedbackComments)
      .where(eq(feedbackComments.id, comment.id));
    expect(movedComments[0]?.postId).toBe(target.id);

    const targetTeamVotes = await db
      .select({ voterId: feedbackVotes.voterId })
      .from(feedbackVotes)
      .where(eq(feedbackVotes.feedbackPostId, target.id));
    expect(targetTeamVotes.map((row) => row.voterId).sort()).toEqual(
      [teamVoter.id, otherTeamVoter.id].sort(),
    );

    const targetCustomerVotes = await db
      .select({ customerId: feedbackCustomerVotes.customerId })
      .from(feedbackCustomerVotes)
      .where(eq(feedbackCustomerVotes.feedbackPostId, target.id));
    expect(targetCustomerVotes.map((row) => row.customerId).sort()).toEqual(
      [customerA.id, customerB.id].sort(),
    );

    const reactions = await db
      .select({ customerId: feedbackReactions.customerId, kind: feedbackReactions.kind })
      .from(feedbackReactions)
      .where(eq(feedbackReactions.feedbackPostId, target.id));
    expect(reactions).toHaveLength(2);
    expect(reactions.map((row) => `${row.customerId}:${row.kind}`).sort()).toEqual(
      [`${customerA.id}:like`, `${customerB.id}:love`].sort(),
    );

    const followers = await db
      .select({ customerId: feedbackFollowers.customerId })
      .from(feedbackFollowers)
      .where(eq(feedbackFollowers.feedbackPostId, target.id));
    expect(followers).toHaveLength(2);

    const links = await db
      .select({ tagId: feedbackTagLinks.tagId })
      .from(feedbackTagLinks)
      .where(eq(feedbackTagLinks.feedbackPostId, target.id));
    expect(links.map((row) => row.tagId).sort()).toEqual(
      [sourceOnlyTag.id, bothTag.id].sort(),
    );

    const journal = await db
      .select()
      .from(feedbackMerges)
      .where(eq(feedbackMerges.id, result.mergeId));
    expect(journal[0]?.movedCommentIds).toEqual([comment.id]);
    expect(journal[0]?.movedCustomerVoteIds).toHaveLength(1);
    expect(journal[0]?.movedTagIds).toEqual([sourceOnlyTag.id]);
  });

  isolatedTest("unmerge restores moved rows without duplicating engagement", async () => {
    const t = await tenant();
    const source = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
      title: "Source",
      status: "planned",
    });
    const target = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
      title: "Target",
    });

    const customerBoth = await createCustomer(t.workspace.id, {
      email: `${uniqueLabel("both")}@example.test`,
      verifiedAt: new Date(),
    });
    const customerSourceOnly = await createCustomer(t.workspace.id, {
      email: `${uniqueLabel("source")}@example.test`,
      verifiedAt: new Date(),
    });

    await db.insert(feedbackCustomerVotes).values([
      { feedbackPostId: source.id, customerId: customerBoth.id },
      { feedbackPostId: target.id, customerId: customerBoth.id },
      { feedbackPostId: source.id, customerId: customerSourceOnly.id },
    ]);
    const comment = await createFeedbackComment({
      productId: t.product.id,
      feedbackPostId: source.id,
    });

    const mergingUser = await createUser();
    const merge = await mergeFeedbackRequests({
      productId: t.product.id,
      sourceId: source.id,
      targetId: target.id,
      userId: mergingUser.id,
    });
    expect(merge.ok).toBe(true);
    if (!merge.ok) return;

    const undone = await unmergeFeedbackRequest({
      productId: t.product.id,
      sourceId: source.id,
    });
    expect(undone.ok).toBe(true);

    const restored = await db
      .select({
        status: feedbackPosts.status,
        mergedIntoId: feedbackPosts.mergedIntoId,
      })
      .from(feedbackPosts)
      .where(eq(feedbackPosts.id, source.id));
    expect(restored[0]).toEqual({ status: "planned", mergedIntoId: null });

    const sourceVotes = await db
      .select({ customerId: feedbackCustomerVotes.customerId })
      .from(feedbackCustomerVotes)
      .where(eq(feedbackCustomerVotes.feedbackPostId, source.id));
    expect(sourceVotes).toEqual([{ customerId: customerSourceOnly.id }]);

    const targetVotes = await db
      .select({ customerId: feedbackCustomerVotes.customerId })
      .from(feedbackCustomerVotes)
      .where(eq(feedbackCustomerVotes.feedbackPostId, target.id));
    expect(targetVotes).toEqual([{ customerId: customerBoth.id }]);

    const sourceComments = await db
      .select({ id: feedbackComments.id })
      .from(feedbackComments)
      .where(
        and(
          eq(feedbackComments.feedbackPostId, source.id),
          eq(feedbackComments.id, comment.id),
        ),
      );
    expect(sourceComments).toHaveLength(1);

    const journal = await db
      .select({ undoneAt: feedbackMerges.undoneAt })
      .from(feedbackMerges)
      .where(eq(feedbackMerges.id, merge.mergeId));
    expect(journal[0]?.undoneAt).not.toBeNull();
  });
});

describe("visibility", () => {
  isolatedTest("a hidden request disappears from the board and its direct URL", async () => {
    const t = await tenant();
    const post = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
      title: "Visible first",
      authorCustomerId: (
        await createCustomer(t.workspace.id, {
          email: `${uniqueLabel("author")}@example.test`,
          verifiedAt: new Date(),
        })
      ).id,
    });

    const input = {
      workspaceSlug: t.workspace.slug,
      productSlug: t.product.slug,
      boardSlug: t.board.slug,
    };
    const query = parsePublicBoardQuery({});

    const visible = await getPublicBoardPage(input, query);
    expect(visible?.requests.map((request) => request.id)).toContain(post.id);

    await db
      .update(feedbackPosts)
      .set({ hiddenAt: new Date() })
      .where(eq(feedbackPosts.id, post.id));

    const hidden = await getPublicBoardPage(input, query);
    expect(hidden?.requests.map((request) => request.id)).not.toContain(post.id);
    expect(
      await getPublicRequestPage({ ...input, requestId: post.id }),
    ).toBeNull();

    await db
      .update(feedbackPosts)
      .set({ hiddenAt: null })
      .where(eq(feedbackPosts.id, post.id));
    expect(
      (await getPublicRequestPage({ ...input, requestId: post.id }))?.request.id,
    ).toBe(post.id);
  });

  isolatedTest("banning a customer revokes sessions and hides their content", async () => {
    const t = await tenant();
    const author = await createCustomer(t.workspace.id, {
      email: `${uniqueLabel("banned")}@example.test`,
      verifiedAt: new Date(),
    });
    const guest = await createGuestCustomerSession(t.workspace.id);
    const post = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
      title: "Authored by a customer",
      authorCustomerId: author.id,
    });
    const otherAuthor = await createCustomer(t.workspace.id, {
      email: `${uniqueLabel("other-author")}@example.test`,
      verifiedAt: new Date(),
    });
    const otherPost = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
      title: "Someone else's request",
      authorCustomerId: otherAuthor.id,
    });
    const bannedComment = await db
      .insert(feedbackComments)
      .values({
        productId: t.product.id,
        feedbackPostId: otherPost.id,
        authorCustomerId: author.id,
        authorName: "Author",
        authorType: "customer",
        body: "A comment from the author who will be banned.",
      })
      .returning({ id: feedbackComments.id });
    const commentId = bannedComment[0]?.id;
    if (!commentId) throw new Error("Comment insert returned no row.");

    const input = {
      workspaceSlug: t.workspace.slug,
      productSlug: t.product.slug,
      boardSlug: t.board.slug,
    };
    expect(
      (await getPublicBoardPage(input, parsePublicBoardQuery({})))?.requests.map(
        (request) => request.id,
      ),
    ).toContain(post.id);
    expect(
      (
        await getPublicRequestPage({ ...input, requestId: otherPost.id })
      )?.request.comments.map((comment) => comment.id),
    ).toContain(commentId);

    const banned = await setCustomerBan({
      workspaceId: t.workspace.id,
      customerId: guest.active.customer.id,
      banned: true,
    });
    expect(banned).toEqual({ ok: true, banned: true });
    expect(await findActiveCustomerSession(guest.cookieValue)).toBeNull();

    await setCustomerBan({
      workspaceId: t.workspace.id,
      customerId: author.id,
      banned: true,
    });

    expect(
      (await getPublicBoardPage(input, parsePublicBoardQuery({})))
        ?.requests.map((request) => request.id),
    ).not.toContain(post.id);
    expect(await getPublicRequestPage({ ...input, requestId: post.id })).toBeNull();
    expect(
      (
        await getPublicRequestPage({ ...input, requestId: otherPost.id })
      )?.request.comments.map((comment) => comment.id),
    ).not.toContain(commentId);

    await setCustomerBan({
      workspaceId: t.workspace.id,
      customerId: author.id,
      banned: false,
    });
    expect(
      (await getPublicBoardPage(input, parsePublicBoardQuery({})))?.requests.map(
        (request) => request.id,
      ),
    ).toContain(post.id);
  });
});

describe("tags", () => {
  isolatedTest("creates, assigns and deletes board-scoped tags", async () => {
    const t = await tenant();
    const post = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
      title: "Tagged request",
    });

    const created = await createTag({
      productId: t.product.id,
      boardId: t.board.id,
      name: "billing",
      color: "#4f46e5",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const duplicate = await createTag({
      productId: t.product.id,
      boardId: t.board.id,
      name: "billing",
      color: null,
    });
    expect(duplicate.ok).toBe(false);

    const assigned = await replacePostTags({
      productId: t.product.id,
      postId: post.id,
      tagIds: [created.data.tagId],
    });
    expect(assigned.ok).toBe(true);

    const links = await db
      .select({ tagId: feedbackTagLinks.tagId })
      .from(feedbackTagLinks)
      .where(eq(feedbackTagLinks.feedbackPostId, post.id));
    expect(links).toEqual([{ tagId: created.data.tagId }]);

    const deleted = await deleteTag({
      productId: t.product.id,
      tagId: created.data.tagId,
    });
    expect(deleted.ok).toBe(true);
    const remaining = await db
      .select({ id: feedbackTagLinks.tagId })
      .from(feedbackTagLinks)
      .where(eq(feedbackTagLinks.feedbackPostId, post.id));
    expect(remaining).toHaveLength(0);
  });

  isolatedTest("refuses a tag from another board or product", async () => {
    const t = await tenant();
    const otherBoard = await createBoard(t.product.id, {
      slug: "other",
      name: "Other board",
    });
    const otherProductWorkspace = await createProduct(t.workspace.id);
    const foreignBoard = await createBoard(otherProductWorkspace.id, {
      slug: "foreign",
      name: "Foreign board",
    });

    const own = await createTag({
      productId: t.product.id,
      boardId: t.board.id,
      name: "own",
      color: null,
    });
    const foreign = await createTag({
      productId: otherProductWorkspace.id,
      boardId: foreignBoard.id,
      name: "foreign",
      color: null,
    });
    if (!own.ok || !foreign.ok) throw new Error("Tags were not created.");

    const post = await createFeedbackPost({
      productId: t.product.id,
      boardId: otherBoard.id,
      title: "On the other board",
    });

    const wrongBoard = await replacePostTags({
      productId: t.product.id,
      postId: post.id,
      tagIds: [own.data.tagId],
    });
    expect(wrongBoard.ok).toBe(false);

    const crossProduct = await replacePostTags({
      productId: t.product.id,
      postId: post.id,
      tagIds: [foreign.data.tagId],
    });
    expect(crossProduct.ok).toBe(false);
  });
});

describe("follows and preferences", () => {
  isolatedTest("voting follows the request", async () => {
    const t = await tenant();
    const post = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
      title: "Follow on vote",
    });
    const resolved = await resolvePublicBoard({
      workspaceSlug: t.workspace.slug,
      productSlug: t.product.slug,
      boardSlug: t.board.slug,
    });
    if (!resolved) throw new Error("The public board did not resolve.");

    const customer = await createCustomer(t.workspace.id, {
      email: `${uniqueLabel("voter")}@example.test`,
      verifiedAt: new Date(),
    });

    const result = await setCustomerVote({
      tenant: resolved,
      requestId: post.id,
      customerId: customer.id,
      voted: true,
    });
    expect(result.ok).toBe(true);

    const follows = await db
      .select({ id: feedbackFollowers.id })
      .from(feedbackFollowers)
      .where(
        and(
          eq(feedbackFollowers.feedbackPostId, post.id),
          eq(feedbackFollowers.customerId, customer.id),
        ),
      );
    expect(follows).toHaveLength(1);
  });

  isolatedTest("a preference token turns updates and win-back on and off", async () => {
    const t = await tenant();
    const token = createPreferenceToken();
    const email = `${uniqueLabel("prefs")}@example.test`;

    await db.insert(subscribers).values({
      productId: t.product.id,
      email,
      emailNormalized: normalizeEmail(email),
      status: "active",
      source: "manual",
      unsubscribeToken: token,
    });

    const initial = await getSubscriberPreferences(token);
    expect(initial).toMatchObject({
      email,
      productUpdates: true,
      winback: true,
      product: { slug: t.product.slug },
      workspace: { slug: t.workspace.slug },
    });

    const off = await updateSubscriberPreferences(token, {
      productUpdates: false,
      winback: false,
    });
    expect(off).toMatchObject({ productUpdates: false, winback: false });

    const row = await db
      .select({
        status: subscribers.status,
        unsubscribedAt: subscribers.unsubscribedAt,
        winbackOptedOutAt: subscribers.winbackOptedOutAt,
      })
      .from(subscribers)
      .where(eq(subscribers.unsubscribeToken, token));
    expect(row[0]?.status).toBe("unsubscribed");
    expect(row[0]?.unsubscribedAt).not.toBeNull();
    expect(row[0]?.winbackOptedOutAt).not.toBeNull();

    const on = await updateSubscriberPreferences(token, {
      productUpdates: true,
      winback: true,
    });
    expect(on).toMatchObject({ productUpdates: true, winback: true });

    expect(await getSubscriberPreferences("not-a-real-token")).toBeNull();
  });

  isolatedTest("status, reply and digest choices are saved independently", async () => {
    const t = await tenant();
    const token = createPreferenceToken();
    const email = `${uniqueLabel("digest-prefs")}@example.test`;

    await db.insert(subscribers).values({
      productId: t.product.id,
      email,
      emailNormalized: normalizeEmail(email),
      status: "active",
      source: "manual",
      unsubscribeToken: token,
    });

    const saved = await updateSubscriberPreferences(token, {
      productUpdates: true,
      winback: true,
      notifyStatusChanges: false,
      notifyReplies: false,
      weeklyDigest: true,
    });
    expect(saved).toMatchObject({
      notifyStatusChanges: false,
      notifyReplies: false,
      weeklyDigest: true,
    });

    // Turning the product-update subscription off also turns off the digest,
    // because the digest is itself a product-update email.
    const off = await updateSubscriberPreferences(token, {
      productUpdates: false,
      winback: true,
      notifyStatusChanges: false,
      notifyReplies: false,
      weeklyDigest: true,
    });
    expect(off).toMatchObject({ productUpdates: false, weeklyDigest: false });
  });

  isolatedTest("the preferences API rejects a foreign origin and saves a same-origin change", async () => {
    const t = await tenant();
    const token = createPreferenceToken();
    const email = `${uniqueLabel("api-prefs")}@example.test`;
    await db.insert(subscribers).values({
      productId: t.product.id,
      email,
      emailNormalized: normalizeEmail(email),
      status: "active",
      source: "manual",
      unsubscribeToken: token,
    });

    const origin = new URL(getServerEnv().BETTER_AUTH_URL).origin;
    const url = `${origin}/api/public/email-preferences?token=${token}`;
    const read = await readPreferences(new NextRequest(url));
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      preferences: { email, productUpdates: true, winback: true },
    });

    const crossOrigin = await savePreferences(
      new NextRequest(`${origin}/api/public/email-preferences`, {
        method: "POST",
        headers: { origin: "http://evil.test", "content-type": "application/json" },
        body: JSON.stringify({ token, productUpdates: false, winback: false }),
      }),
    );
    expect(crossOrigin.status).toBe(403);

    const saved = await savePreferences(
      new NextRequest(`${origin}/api/public/email-preferences`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ token, productUpdates: false, winback: true }),
      }),
    );
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      preferences: { productUpdates: false, winback: true },
    });

    const withChannels = await savePreferences(
      new NextRequest(`${origin}/api/public/email-preferences`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          token,
          productUpdates: true,
          winback: true,
          notifyStatusChanges: false,
          notifyReplies: true,
          weeklyDigest: true,
        }),
      }),
    );
    expect(withChannels.status).toBe(200);
    expect(await withChannels.json()).toMatchObject({
      preferences: {
        productUpdates: true,
        notifyStatusChanges: false,
        notifyReplies: true,
        weeklyDigest: true,
      },
    });
  });
});
