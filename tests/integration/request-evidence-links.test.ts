import { afterAll, beforeAll, describe, expect } from "bun:test";

import { and, count, eq } from "drizzle-orm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { db } from "@/db";
import { conversationMessages } from "@/db/schema/conversations";
import { feedbackPosts } from "@/db/schema/feedback";
import { feedbackContextLinks } from "@/db/schema/feedback-extensions";
import { workspaces } from "@/db/schema/workspaces";
import { linkConversationMessageToRequest } from "@/features/conversations/handoff";
import {
  addRequestContextLink,
  removeRequestContextLink,
} from "@/features/feedback/context";
import {
  addRequestInsight,
  listRequestInsights,
} from "@/features/feedback/insights";
import { createHelpArticle, createHelpCollection } from "@/features/help/service";
import { getPublicRequestPage } from "@/features/public/queries";
import { summarizeRequestDemand } from "@/lib/request-demand";

import {
  createBoard,
  createConversation,
  createConversationMessage,
  createCustomer,
  createFeedbackPost,
  createMember,
  createProduct,
  createRelease,
  createWorkspace,
} from "./factories";
import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";

/**
 * Evidence and context around a request.
 *
 * Three rules are easy to break and expensive to get wrong: linking a support
 * message must not file a duplicate request, context must never inflate demand,
 * and the public page may show the counts but never the quotes or their
 * authors.
 */

const previous: Record<string, string | undefined> = {};
let storageDir: string;

beforeAll(async () => {
  previous.FLAG_PUBLIC_FEEDBACK = process.env.FLAG_PUBLIC_FEEDBACK;
  previous.STORAGE_DIR = process.env.STORAGE_DIR;
  previous.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL;
  previous.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET;

  process.env.FLAG_PUBLIC_FEEDBACK = "on";
  process.env.BETTER_AUTH_URL ??= "http://app.local";
  process.env.BETTER_AUTH_SECRET ??= "integration-secret-value-at-least-32-chars";

  storageDir = await mkdtemp(path.join(tmpdir(), "herald-evidence-"));
  process.env.STORAGE_DIR = storageDir;

  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(storageDir, { recursive: true, force: true });
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

async function tenant() {
  const workspace = await createWorkspace();
  const product = await createProduct(workspace.id);
  const board = await createBoard(product.id, { slug: "feedback", name: "Feedback" });
  return { workspace, product, board };
}

async function countPosts(productId: string): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(feedbackPosts)
    .where(eq(feedbackPosts.productId, productId));
  return Number(rows[0]?.value ?? 0);
}

describe("linking a support message to an existing request", () => {
  isolatedTest("records the message as evidence without filing a duplicate", async () => {
    const t = await tenant();
    const customer = await createCustomer(t.workspace.id, {
      name: "Ada Lovelace",
      email: "ada@example.test",
    });
    const { user } = await createMember(t.workspace.id, { role: "editor" });
    const conversation = await createConversation({
      workspaceId: t.workspace.id,
      productId: t.product.id,
      customerId: customer.id,
      subject: "SSO for our team",
    });
    const message = await createConversationMessage({
      conversation,
      authorType: "customer",
      body: "  We cannot sign the contract without SSO.  ",
    });
    const post = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
      title: "SAML single sign-on",
    });

    const before = await countPosts(t.product.id);
    const linked = await linkConversationMessageToRequest({
      productId: t.product.id,
      conversationId: conversation.id,
      messageId: message.id,
      postId: post.id,
      userId: user.id,
    });

    expect(linked.ok).toBe(true);
    if (!linked.ok) return;

    // The request count is unchanged: this path attaches evidence, it does not
    // create a second request for the same problem.
    expect(await countPosts(t.product.id)).toBe(before);

    const insights = await listRequestInsights({
      productId: t.product.id,
      postId: post.id,
    });
    expect(insights).toHaveLength(1);
    expect(insights[0]).toMatchObject({
      id: linked.data.insightId,
      source: "support",
      sourceRef: conversation.id,
      authorCustomerId: customer.id,
      authorLabel: "Ada Lovelace",
      quote: "We cannot sign the contract without SSO.",
    });

    const notes = await db
      .select({ body: conversationMessages.body, kind: conversationMessages.kind })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.conversationId, conversation.id),
          eq(conversationMessages.kind, "note"),
        ),
      );
    expect(notes).toHaveLength(1);
    expect(notes[0]?.body).toContain("Linked this message to feedback request");

    // Clicking again is a no-op rather than a second copy of the evidence.
    const again = await linkConversationMessageToRequest({
      productId: t.product.id,
      conversationId: conversation.id,
      messageId: message.id,
      postId: post.id,
      userId: user.id,
    });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.data.insightId).toBe(linked.data.insightId);
    expect(
      await listRequestInsights({ productId: t.product.id, postId: post.id }),
    ).toHaveLength(1);
  });

  isolatedTest("refuses team messages, foreign posts and foreign conversations", async () => {
    const mine = await tenant();
    const theirs = await tenant();
    const customer = await createCustomer(mine.workspace.id, { name: "Ada" });
    const { user } = await createMember(mine.workspace.id, { role: "editor" });

    const conversation = await createConversation({
      workspaceId: mine.workspace.id,
      productId: mine.product.id,
      customerId: customer.id,
    });
    const customerMessage = await createConversationMessage({
      conversation,
      authorType: "customer",
      body: "Please add audit logs.",
    });
    const teamMessage = await createConversationMessage({
      conversation,
      authorType: "team",
      authorUserId: user.id,
      body: "Thanks, noted.",
    });
    const post = await createFeedbackPost({
      productId: mine.product.id,
      boardId: mine.board.id,
    });
    const foreignPost = await createFeedbackPost({
      productId: theirs.product.id,
      boardId: theirs.board.id,
    });

    const teamReply = await linkConversationMessageToRequest({
      productId: mine.product.id,
      conversationId: conversation.id,
      messageId: teamMessage.id,
      postId: post.id,
      userId: user.id,
    });
    expect(teamReply.ok).toBe(false);

    const foreignRequest = await linkConversationMessageToRequest({
      productId: mine.product.id,
      conversationId: conversation.id,
      messageId: customerMessage.id,
      postId: foreignPost.id,
      userId: user.id,
    });
    expect(foreignRequest.ok).toBe(false);

    const foreignThread = await linkConversationMessageToRequest({
      productId: theirs.product.id,
      conversationId: conversation.id,
      messageId: customerMessage.id,
      postId: foreignPost.id,
      userId: user.id,
    });
    expect(foreignThread.ok).toBe(false);

    expect(
      await listRequestInsights({ productId: mine.product.id, postId: post.id }),
    ).toHaveLength(0);
  });
});

describe("help article and changelog context", () => {
  isolatedTest("attaches both kinds, dedupes, and never counts as demand", async () => {
    const t = await tenant();
    const { user } = await createMember(t.workspace.id, { role: "editor" });
    const post = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
    });

    const collection = await createHelpCollection({
      workspaceId: t.workspace.id,
      productId: t.product.id,
      userId: user.id,
      name: "Security",
      slug: "security",
    });
    if (!collection.ok || !collection.id) {
      throw new Error(collection.ok ? "Collection id missing." : collection.error);
    }
    const article = await createHelpArticle({
      workspaceId: t.workspace.id,
      productId: t.product.id,
      userId: user.id,
      collectionId: collection.id,
      title: "Set up SSO",
      slug: "set-up-sso",
      body: "Open Settings, choose SSO, then follow the identity-provider steps.",
    });
    if (!article.ok || !article.id) {
      throw new Error(article.ok ? "Article id missing." : article.error);
    }
    const release = await createRelease({
      productId: t.product.id,
      title: "Audit log export",
      status: "published",
    });

    const help = await addRequestContextLink({
      productId: t.product.id,
      postId: post.id,
      kind: "help_article",
      refId: article.id,
      createdBy: user.id,
    });
    expect(help.ok).toBe(true);

    const duplicate = await addRequestContextLink({
      productId: t.product.id,
      postId: post.id,
      kind: "help_article",
      refId: article.id,
    });
    expect(duplicate.ok).toBe(true);
    if (!help.ok || !duplicate.ok) return;
    expect(duplicate.alreadyLinked).toBe(true);
    expect(duplicate.linkId).toBe(help.linkId);

    const changelog = await addRequestContextLink({
      productId: t.product.id,
      postId: post.id,
      kind: "changelog",
      refId: release.id,
    });
    expect(changelog.ok).toBe(true);
    if (!changelog.ok) return;

    const links = await db
      .select({ id: feedbackContextLinks.id, kind: feedbackContextLinks.kind })
      .from(feedbackContextLinks)
      .where(eq(feedbackContextLinks.feedbackPostId, post.id));
    expect(links.map((link) => link.kind).sort()).toEqual([
      "changelog",
      "help_article",
    ]);

    // Context is reference material: no evidence rows, so demand stays at zero.
    expect(
      await listRequestInsights({ productId: t.product.id, postId: post.id }),
    ).toHaveLength(0);
    expect(summarizeRequestDemand([])).toEqual({ customers: 0, sources: 0 });

    const wrongRequest = await removeRequestContextLink({
      productId: t.product.id,
      postId: (
        await createFeedbackPost({ productId: t.product.id, boardId: t.board.id })
      ).id,
      linkId: help.linkId,
    });
    expect(wrongRequest.ok).toBe(false);

    const removed = await removeRequestContextLink({
      productId: t.product.id,
      postId: post.id,
      linkId: help.linkId,
    });
    expect(removed.ok).toBe(true);
    const remaining = await db
      .select({ id: feedbackContextLinks.id })
      .from(feedbackContextLinks)
      .where(eq(feedbackContextLinks.feedbackPostId, post.id));
    expect(remaining.map((row) => row.id)).toEqual([changelog.linkId]);
  });

  isolatedTest("refuses an article or release from another product", async () => {
    const mine = await tenant();
    const theirs = await tenant();
    const { user } = await createMember(mine.workspace.id, { role: "editor" });
    const post = await createFeedbackPost({
      productId: mine.product.id,
      boardId: mine.board.id,
    });

    const foreignCollection = await createHelpCollection({
      workspaceId: theirs.workspace.id,
      productId: theirs.product.id,
      userId: user.id,
      name: "Foreign",
      slug: "foreign",
    });
    if (!foreignCollection.ok || !foreignCollection.id) {
      throw new Error("Foreign collection setup failed.");
    }
    const foreignArticle = await createHelpArticle({
      workspaceId: theirs.workspace.id,
      productId: theirs.product.id,
      userId: user.id,
      collectionId: foreignCollection.id,
      title: "Foreign article",
      slug: "foreign-article",
      body: "This belongs to another product.",
    });
    if (!foreignArticle.ok || !foreignArticle.id) {
      throw new Error("Foreign article setup failed.");
    }
    const foreignRelease = await createRelease({ productId: theirs.product.id });

    const articleLink = await addRequestContextLink({
      productId: mine.product.id,
      postId: post.id,
      kind: "help_article",
      refId: foreignArticle.id,
    });
    expect(articleLink.ok).toBe(false);

    const releaseLink = await addRequestContextLink({
      productId: mine.product.id,
      postId: post.id,
      kind: "changelog",
      refId: foreignRelease.id,
    });
    expect(releaseLink.ok).toBe(false);

    const rows = await db
      .select({ id: feedbackContextLinks.id })
      .from(feedbackContextLinks)
      .where(eq(feedbackContextLinks.feedbackPostId, post.id));
    expect(rows).toHaveLength(0);
  });
});

describe("public demand", () => {
  isolatedTest("shows counts only, never quotes or the people behind them", async () => {
    const t = await tenant();
    const ada = await createCustomer(t.workspace.id, { name: "Ada Secret" });
    const grace = await createCustomer(t.workspace.id, { name: "Grace Secret" });
    const author = await createCustomer(t.workspace.id, { name: "Request Author" });
    const post = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
      title: "Audit log export",
      authorCustomerId: author.id,
      authorLabel: "Request Author",
    });

    for (const [quote, customerId, sourceRef] of [
      ["SECRET-QUOTE-ONE from a call.", ada.id, "call-1"],
      ["SECRET-QUOTE-TWO from an email.", ada.id, "email-1"],
      ["SECRET-QUOTE-THREE from a chat.", grace.id, "chat-1"],
      ["SECRET-QUOTE-FOUR again in the same chat.", grace.id, "chat-1"],
    ] as const) {
      const added = await addRequestInsight({
        productId: t.product.id,
        postId: post.id,
        quote,
        source: "support",
        sourceRef,
        authorCustomerId: customerId,
      });
      expect(added.ok).toBe(true);
    }

    const page = await getPublicRequestPage({
      workspaceSlug: t.workspace.slug,
      productSlug: t.product.slug,
      boardSlug: t.board.slug,
      requestId: post.id,
    });

    expect(page).not.toBeNull();
    // Four rows, two customers, three distinct sources (the chat repeats).
    expect(page?.request.demand).toEqual({ customers: 2, sources: 3 });

    const serialized = JSON.stringify(page);
    expect(serialized).not.toContain("SECRET-QUOTE");
    expect(serialized).not.toContain("Ada Secret");
    expect(serialized).not.toContain("Grace Secret");
    expect(serialized).not.toContain("call-1");
    expect(serialized).not.toContain("email-1");
  });

  isolatedTest("shows the planned target only when the workspace policy allows it", async () => {
    const t = await tenant();
    const post = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
      title: "Audit log export",
    });
    await db
      .update(feedbackPosts)
      .set({ plannedFor: "2027-Q1" })
      .where(eq(feedbackPosts.id, post.id));

    const input = {
      workspaceSlug: t.workspace.slug,
      productSlug: t.product.slug,
      boardSlug: t.board.slug,
      requestId: post.id,
    };

    // The policy is off by default: a stored target is internal.
    const internal = await getPublicRequestPage(input);
    expect(internal?.request.plannedFor).toBeNull();

    await db
      .update(workspaces)
      .set({ publicPlannedFor: true })
      .where(eq(workspaces.id, t.workspace.id));

    const disclosed = await getPublicRequestPage(input);
    expect(disclosed?.request.plannedFor).toBe("2027-Q1");

    // Turning the policy back off hides it again without clearing the row.
    await db
      .update(workspaces)
      .set({ publicPlannedFor: false })
      .where(eq(workspaces.id, t.workspace.id));
    const hiddenAgain = await getPublicRequestPage(input);
    expect(hiddenAgain?.request.plannedFor).toBeNull();
  });
});
