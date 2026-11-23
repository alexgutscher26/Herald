import { afterAll, beforeAll, describe, expect } from "bun:test";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { conversationMessages } from "@/db/schema/conversations";
import { feedbackPosts } from "@/db/schema/feedback";
import {
  duplicateReviews,
  feedbackMerges,
} from "@/db/schema/feedback-extensions";
import {
  agentActionRuns,
  agentActionSettings,
} from "@/db/schema/knowledge";
import { notificationDeliveries } from "@/db/schema/notifications";
import { unmergeFeedbackRequest } from "@/features/feedback/merge";
import {
  executeRequestedAgentAction,
  saveAgentActionSetting,
} from "@/features/juno/agent-actions";
import { suggestDuplicatesForPost } from "@/features/juno/auxiliary";
import { resolveDuplicateReview } from "@/features/juno/duplicate-review";
import { ensureJunoSettings, saveJunoSettings } from "@/features/juno/settings";

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
 * Backlog integration.
 *
 * These tests use the application's real transactional paths: duplicate
 * decisions, feedback merge history, the action allowlist, the delivery outbox
 * and the audit rows. No provider is called.
 */

let previous: Record<string, string | undefined> = {};

beforeAll(async () => {
  previous = {
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    AI_API_URL: process.env.AI_API_URL,
    AI_API_KEY: process.env.AI_API_KEY,
    AI_MODEL: process.env.AI_MODEL,
  };
  process.env.BETTER_AUTH_URL ??= "http://app.local";
  process.env.BETTER_AUTH_SECRET ??= "integration-secret-value-at-least-32-chars";
  process.env.AI_API_URL = "http://127.0.0.1:9/v1";
  process.env.AI_MODEL = "test-model";
  delete process.env.AI_API_KEY;
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

async function setupProduct(duplicateMode: "assisted" | "automatic") {
  const workspace = await createWorkspace({ plan: "pro" });
  const product = await createProduct(workspace.id);
  const board = await createBoard(product.id, { name: "Requests" });
  const { user } = await createMember(workspace.id, { role: "admin" });

  await ensureJunoSettings(product.id);
  const saved = await saveJunoSettings({
    productId: product.id,
    enabled: true,
    duplicateMode,
    submissionAssistantEnabled: false,
    tone: "warm",
    replyLength: "short",
    formality: "neutral",
    emoji: false,
    language: "auto",
    model: "",
    confidenceFloor: 0.05,
    dailyBudgetCents: 100,
    autoResolveChatMinutes: 30,
    autoResolveEmailMinutes: 4320,
  });
  if (!saved.ok) throw new Error(saved.error);

  return { workspace, product, board, user };
}

describe("duplicate linking", () => {
  isolatedTest(
    "automatic mode merges a high-confidence match and merge history can undo it",
    async () => {
      const context = await setupProduct("automatic");
      const target = await createFeedbackPost({
        productId: context.product.id,
        boardId: context.board.id,
        title: "Dark mode for the dashboard",
        body: "Please add a dark mode setting to the dashboard.",
      });
      const source = await createFeedbackPost({
        productId: context.product.id,
        boardId: context.board.id,
        title: "Dark mode for the dashboard",
        body: "Please add a dark mode setting to the dashboard.",
      });

      const suggestion = await suggestDuplicatesForPost({
        productId: context.product.id,
        feedbackPostId: source.id,
      });
      expect(suggestion.autoMerged).toBe(true);

      const [mergedSource] = await db
        .select()
        .from(feedbackPosts)
        .where(eq(feedbackPosts.id, source.id));
      expect(mergedSource?.mergedIntoId).toBe(target.id);

      const [merge] = await db
        .select()
        .from(feedbackMerges)
        .where(
          and(
            eq(feedbackMerges.productId, context.product.id),
            eq(feedbackMerges.sourcePostId, source.id),
          ),
        );
      expect(merge?.automatic).toBe(true);
      expect(merge?.createdBy).toBeNull();

      const [review] = await db
        .select()
        .from(duplicateReviews)
        .where(eq(duplicateReviews.sourcePostId, source.id));
      expect(review?.status).toBe("merged");
      expect(review?.mode).toBe("automatic");

      const undone = await unmergeFeedbackRequest({
        productId: context.product.id,
        sourceId: source.id,
      });
      expect(undone.ok).toBe(true);

      const [restored] = await db
        .select()
        .from(feedbackPosts)
        .where(eq(feedbackPosts.id, source.id));
      expect(restored?.mergedIntoId).toBeNull();

      const [undoneMerge] = await db
        .select()
        .from(feedbackMerges)
        .where(eq(feedbackMerges.id, merge!.id));
      expect(undoneMerge?.undoneAt).not.toBeNull();
    },
  );

  isolatedTest(
    "assisted mode queues a match and only a person can merge it",
    async () => {
      const context = await setupProduct("assisted");
      const target = await createFeedbackPost({
        productId: context.product.id,
        boardId: context.board.id,
        title: "Dark mode",
        body: "Add a dark mode to the dashboard.",
      });
      const source = await createFeedbackPost({
        productId: context.product.id,
        boardId: context.board.id,
        title: "Dark mode",
        body: "The dashboard needs a dark mode.",
      });

      const suggestion = await suggestDuplicatesForPost({
        productId: context.product.id,
        feedbackPostId: source.id,
      });
      expect(suggestion.autoMerged).toBeUndefined();

      const [queued] = await db
        .select()
        .from(duplicateReviews)
        .where(eq(duplicateReviews.sourcePostId, source.id));
      expect(queued?.status).toBe("pending");
      expect(queued?.mode).toBe("assisted");

      const [untouched] = await db
        .select()
        .from(feedbackPosts)
        .where(eq(feedbackPosts.id, source.id));
      expect(untouched?.mergedIntoId).toBeNull();

      const resolved = await resolveDuplicateReview({
        productId: context.product.id,
        reviewId: queued!.id,
        userId: context.user.id,
        decision: "merge",
      });
      expect(resolved.ok).toBe(true);

      const [mergedSource] = await db
        .select()
        .from(feedbackPosts)
        .where(eq(feedbackPosts.id, source.id));
      expect(mergedSource?.mergedIntoId).toBe(target.id);

      const [merge] = await db
        .select()
        .from(feedbackMerges)
        .where(eq(feedbackMerges.sourcePostId, source.id));
      expect(merge?.automatic).toBe(false);
      expect(merge?.createdBy).toBe(context.user.id);

      const [closedReview] = await db
        .select()
        .from(duplicateReviews)
        .where(eq(duplicateReviews.id, queued!.id));
      expect(closedReview?.status).toBe("merged");
    },
  );
});

describe("rule-bounded actions", () => {
  isolatedTest(
    "transcript email stays off until reviewed, then writes an audit row and delivery",
    async () => {
      const context = await setupProduct("assisted");
      const customer = await createCustomer(context.workspace.id, {
        name: "Ada Lovelace",
        email: "ada@example.test",
      });
      const conversation = await createConversation({
        workspaceId: context.workspace.id,
        productId: context.product.id,
        customerId: customer.id,
        subject: "Need a copy",
      });

      const disabled = await executeRequestedAgentAction({
        productId: context.product.id,
        conversationId: conversation.id,
        question: "Please email me a transcript of this conversation.",
      });
      expect(disabled).toMatchObject({
        handled: true,
        queued: false,
        reason: "disabled",
      });
      expect(
        await db
          .select()
          .from(agentActionRuns)
          .where(eq(agentActionRuns.conversationId, conversation.id)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(notificationDeliveries)
          .where(eq(notificationDeliveries.conversationId, conversation.id)),
      ).toHaveLength(0);

      const approved = await saveAgentActionSetting({
        workspaceId: context.workspace.id,
        productId: context.product.id,
        action: "send_transcript",
        enabled: true,
        userId: context.user.id,
      });
      expect(approved.ok).toBe(true);

      const [setting] = await db
        .select()
        .from(agentActionSettings)
        .where(eq(agentActionSettings.productId, context.product.id));
      expect(setting?.reviewedBy).toBe(context.user.id);
      expect(setting?.reviewedAt).not.toBeNull();

      const executed = await executeRequestedAgentAction({
        productId: context.product.id,
        conversationId: conversation.id,
        question: "Please email me a transcript of this conversation.",
      });
      expect(executed).toMatchObject({ handled: true, queued: true });

      const [run] = await db
        .select()
        .from(agentActionRuns)
        .where(eq(agentActionRuns.conversationId, conversation.id));
      expect(run?.action).toBe("send_transcript");
      expect(run?.status).toBe("queued");
      expect(run?.deliveryId).not.toBeNull();
      expect(run?.messageId).not.toBeNull();

      const [delivery] = await db
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.conversationId, conversation.id));
      expect(delivery?.template).toBe("conversation_transcript");
      expect(delivery?.status).toBe("pending");
      expect(delivery?.recipientEmailNormalized).toBe("ada@example.test");

      const messages = await db
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, conversation.id));
      expect(messages.some((message) => message.authorType === "juno")).toBe(true);
    },
  );
});
