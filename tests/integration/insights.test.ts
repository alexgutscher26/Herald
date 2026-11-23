import { afterAll, beforeAll, describe, expect } from "bun:test";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { feedbackInsights, feedbackMerges } from "@/db/schema";
import {
  addRequestInsight,
  deleteRequestInsight,
  listRequestInsights,
} from "@/features/feedback/insights";
import {
  mergeFeedbackRequests,
  unmergeFeedbackRequest,
} from "@/features/feedback/merge";

import {
  createBoard,
  createCustomer,
  createFeedbackPost,
  createProduct,
  createUser,
  createWorkspace,
} from "./factories";
import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";

/**
 * Evidence rows against real Postgres.
 *
 * The action that matters here is the one nobody watches: a merge. Evidence
 * that stays on the closed duplicate is evidence the team can no longer cite,
 * so the move and the undo are both exercised directly.
 */

beforeAll(async () => {
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

async function tenant() {
  const workspace = await createWorkspace();
  const product = await createProduct(workspace.id);
  const board = await createBoard(product.id, { slug: "feedback", name: "Feedback" });
  return { workspace, product, board };
}

describe("request insights", () => {
  isolatedTest("stores the wording, source and author of one piece of evidence", async () => {
    const t = await tenant();
    const customer = await createCustomer(t.workspace.id, { name: "Ada" });
    const post = await createFeedbackPost({ productId: t.product.id, boardId: t.board.id });
    const user = await createUser();

    const added = await addRequestInsight({
      productId: t.product.id,
      postId: post.id,
      quote: "  We need SSO before we can sign the contract.  ",
      source: "call",
      sourceRef: "call_42",
      authorLabel: "Ada",
      authorCustomerId: customer.id,
      createdBy: user.id,
    });

    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.insight.quote).toBe("We need SSO before we can sign the contract.");
    expect(added.insight.source).toBe("call");
    expect(added.insight.authorCustomerId).toBe(customer.id);
    expect(added.insight.createdBy).toBe(user.id);

    const listed = await listRequestInsights({ productId: t.product.id, postId: post.id });
    expect(listed.map((row) => row.id)).toEqual([added.insight.id]);

    const removed = await deleteRequestInsight({
      productId: t.product.id,
      postId: post.id,
      insightId: added.insight.id,
    });
    expect(removed.ok).toBe(true);
    expect(await listRequestInsights({ productId: t.product.id, postId: post.id })).toHaveLength(0);
  });

  isolatedTest("refuses to attach evidence to a request in another product", async () => {
    const mine = await tenant();
    const theirs = await tenant();
    const foreign = await createFeedbackPost({
      productId: theirs.product.id,
      boardId: theirs.board.id,
    });

    const added = await addRequestInsight({
      productId: mine.product.id,
      postId: foreign.id,
      quote: "This should not land anywhere.",
      source: "email",
    });

    expect(added.ok).toBe(false);
    const rows = await db
      .select({ id: feedbackInsights.id })
      .from(feedbackInsights)
      .where(eq(feedbackInsights.feedbackPostId, foreign.id));
    expect(rows).toHaveLength(0);
  });

  isolatedTest("moves evidence when requests merge and restores it on unmerge", async () => {
    const t = await tenant();
    const user = await createUser();
    const source = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
      title: "Duplicate request",
    });
    const target = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
      title: "Canonical request",
    });

    for (const [quote, sourceKind] of [
      ["Asked on a call in October.", "call"],
      ["Asked again over email in November.", "email"],
    ] as const) {
      const added = await addRequestInsight({
        productId: t.product.id,
        postId: source.id,
        quote,
        source: sourceKind,
      });
      expect(added.ok).toBe(true);
    }

    const merged = await mergeFeedbackRequests({
      productId: t.product.id,
      sourceId: source.id,
      targetId: target.id,
      userId: user.id,
    });
    expect(merged.ok).toBe(true);

    const onTarget = await listRequestInsights({
      productId: t.product.id,
      postId: target.id,
    });
    expect(onTarget).toHaveLength(2);
    expect(
      await listRequestInsights({ productId: t.product.id, postId: source.id }),
    ).toHaveLength(0);

    const mergeRows = await db
      .select({ movedInsightIds: feedbackMerges.movedInsightIds })
      .from(feedbackMerges)
      .where(
        and(
          eq(feedbackMerges.productId, t.product.id),
          eq(feedbackMerges.sourcePostId, source.id),
        ),
      );
    expect(mergeRows[0]?.movedInsightIds).toHaveLength(2);

    const undone = await unmergeFeedbackRequest({
      productId: t.product.id,
      sourceId: source.id,
    });
    expect(undone.ok).toBe(true);

    expect(
      await listRequestInsights({ productId: t.product.id, postId: source.id }),
    ).toHaveLength(2);
    expect(
      await listRequestInsights({ productId: t.product.id, postId: target.id }),
    ).toHaveLength(0);
  });

  isolatedTest("deletes only inside the request it was called for", async () => {
    const t = await tenant();
    const first = await createFeedbackPost({ productId: t.product.id, boardId: t.board.id });
    const second = await createFeedbackPost({ productId: t.product.id, boardId: t.board.id });

    const added = await addRequestInsight({
      productId: t.product.id,
      postId: first.id,
      quote: "Keep this on the first request.",
      source: "note",
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    const wrongRequest = await deleteRequestInsight({
      productId: t.product.id,
      postId: second.id,
      insightId: added.insight.id,
    });
    expect(wrongRequest.ok).toBe(false);
    expect(
      await listRequestInsights({ productId: t.product.id, postId: first.id }),
    ).toHaveLength(1);
  });
});
