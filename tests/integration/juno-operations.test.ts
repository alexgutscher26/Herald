import { afterAll, beforeAll, describe, expect } from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { conversations } from "@/db/schema/conversations";
import { feedbackPosts } from "@/db/schema/feedback";
import {
  feedbackCustomerVotes,
  feedbackFollowers,
} from "@/db/schema/feedback-extensions";
import {
  junoAnswers,
  junoConversations,
  junoEvalCases,
  junoFeedbackActions,
  junoKnowledgeTasks,
  junoRedactionEvents,
  junoSuggestions,
} from "@/db/schema/knowledge";
import { getJunoActivity } from "@/features/juno/activity";
import { answerConversation } from "@/features/juno/answer";
import {
  listRecentSuggestions,
  suggestDuplicatesForPost,
  suggestTagsForPost,
} from "@/features/juno/auxiliary";
import {
  addEvalCase,
  listEvalStatus,
  removeEvalCase,
  runJunoEvaluation,
} from "@/features/juno/evaluation";
import {
  loadPendingFeedbackCard,
  maybeOfferFeedbackCard,
  respondToFeedbackCard,
} from "@/features/juno/feedback-cards";
import { ensureJunoSettings, saveJunoSettings } from "@/features/juno/settings";
import { listOpenKnowledgeTasks } from "@/features/juno/knowledge-tasks";
import { rateJunoAnswer } from "@/features/juno/inspection";
import { JUNO_PROMPT_VERSION } from "@/features/juno/prompt-version";
import { createUploadSource } from "@/features/juno/sources";

import {
  createBoard,
  createBoardTag,
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

/**
 * Juno operations against real Postgres.
 *
 * Covers the parts that are not the answer itself: a feedback card is only an
 * offer until the customer confirms it, guest rules and limits are enforced
 * server-side, personal data is redacted before generation, the activity meter
 * reads the audit rows, an unevaluated model change is refused, and auxiliary
 * suggestions are stored without being applied.
 */

let previous: Record<string, string | undefined> = {};

beforeAll(async () => {
  previous = {
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    AI_API_URL: process.env.AI_API_URL,
    AI_API_KEY: process.env.AI_API_KEY,
    AI_MODEL: process.env.AI_MODEL,
    AI_EMBEDDING_MODEL: process.env.AI_EMBEDDING_MODEL,
  };
  process.env.BETTER_AUTH_URL ??= "http://app.local";
  process.env.BETTER_AUTH_SECRET ??= "integration-secret-value-at-least-32-chars";
  // A configured model is required to exercise the evaluation gate, but no
  // test may reach the provider: every generation is injected.
  process.env.AI_API_URL = "http://127.0.0.1:9/v1";
  process.env.AI_MODEL = "test-model";
  delete process.env.AI_API_KEY;
  delete process.env.AI_EMBEDDING_MODEL;
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

async function setupProduct(options: { budget?: number; floor?: number } = {}) {
  // Guest posting is a paid capability; the free plan would correctly refuse
  // the guest confirmation this suite exercises.
  const workspace = await createWorkspace({ plan: "pro" });
  const product = await createProduct(workspace.id);
  const customer = await createCustomer(workspace.id, {
    name: "Ada Lovelace",
    email: "ada@example.test",
  });
  const { user } = await createMember(workspace.id, { role: "admin" });
  const board = await createBoard(product.id, {
    name: "Feature requests",
    guestPosting: true,
  });

  await ensureJunoSettings(product.id);
  const saved = await saveJunoSettings(
    settingsInput(product.id, {
      enabled: true,
      confidenceFloor: options.floor ?? 0.05,
      dailyBudgetCents: options.budget ?? 100,
      model: "",
    }),
  );
  if (!saved.ok) throw new Error(saved.error);

  return { workspace, product, customer, user, board };
}

function settingsInput(
  productId: string,
  overrides: Partial<{
    enabled: boolean;
    model: string;
    confidenceFloor: number;
    dailyBudgetCents: number;
  }> = {},
) {
  return {
    productId,
    enabled: overrides.enabled ?? true,
    duplicateMode: "assisted",
    submissionAssistantEnabled: false,
    tone: "warm",
    replyLength: "short",
    formality: "neutral",
    emoji: false,
    language: "auto",
    model: overrides.model ?? "",
    confidenceFloor: overrides.confidenceFloor ?? 0.05,
    dailyBudgetCents: overrides.dailyBudgetCents ?? 100,
    autoResolveChatMinutes: 30,
    autoResolveEmailMinutes: 4320,
  };
}

async function upload(
  context: Awaited<ReturnType<typeof setupProduct>>,
  content: string,
): Promise<void> {
  const result = await createUploadSource({
    workspaceId: context.workspace.id,
    productId: context.product.id,
    userId: context.user.id,
    name: "Help center",
    filename: "help.md",
    mimeType: "text/markdown",
    content,
  });
  if (!result.ok) throw new Error(result.error);
}

async function seedWidgetQuestion(
  context: Awaited<ReturnType<typeof setupProduct>>,
  question: string,
) {
  const conversation = await createConversation({
    workspaceId: context.workspace.id,
    productId: context.product.id,
    customerId: context.customer.id,
    subject: "Feature idea",
  });
  await db
    .update(conversations)
    .set({ sourceContext: { channel: "widget" } })
    .where(eq(conversations.id, conversation.id));
  await createConversationMessage({
    conversation,
    authorType: "customer",
    body: question,
  });
  const [updated] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversation.id));
  return updated ?? conversation;
}

function chunk() {
  return {
    chunkId: "00000000-0000-0000-0000-000000000001",
    sourceId: "00000000-0000-0000-0000-000000000002",
    sourceName: "Help center",
    title: "Invite a teammate",
    url: null,
    content: "Invite a teammate from Team settings.",
    score: 0.9,
    lexical: 1,
    vector: 0.8,
  };
}

describe("feedback cards", () => {
  isolatedTest("files a new request only after the customer confirms", async () => {
    const context = await setupProduct();
    await upload(
      context,
      "# Dark mode\n\nDark mode is not available yet. It is on the roadmap.",
    );
    const conversation = await seedWidgetQuestion(
      context,
      "Can you add a dark mode option?",
    );

    const outcome = await answerConversation({
      conversationId: conversation.id,
      productId: context.product.id,
      deps: { generate: async () => "Dark mode is on the roadmap." },
    });
    expect(outcome.status).toBe("answered");

    const card = await loadPendingFeedbackCard(conversation.id);
    expect(card?.kind).toBe("create");

    // The offer alone writes no board content.
    const before = await db
      .select()
      .from(feedbackPosts)
      .where(eq(feedbackPosts.productId, context.product.id));
    expect(before).toHaveLength(0);

    const confirmed = await respondToFeedbackCard({
      actionId: card!.id,
      conversationId: conversation.id,
      customerId: context.customer.id,
      isGuest: true,
      decision: "confirm",
    });
    expect(confirmed.ok).toBe(true);

    const after = await db
      .select()
      .from(feedbackPosts)
      .where(eq(feedbackPosts.productId, context.product.id));
    expect(after).toHaveLength(1);
    expect(after[0]?.title).toContain("dark mode");
    expect(after[0]?.boardId).toBe(context.board.id);
    expect(after[0]?.authorCustomerId).toBe(context.customer.id);

    const [action] = await db
      .select()
      .from(junoFeedbackActions)
      .where(eq(junoFeedbackActions.id, card!.id));
    expect(action?.status).toBe("confirmed");

    const again = await respondToFeedbackCard({
      actionId: card!.id,
      conversationId: conversation.id,
      customerId: context.customer.id,
      isGuest: true,
      decision: "confirm",
    });
    expect(again.ok).toBe(false);
    expect(await loadPendingFeedbackCard(conversation.id)).toBeNull();
  });

  isolatedTest("a guest cannot vote or follow, and a member can", async () => {
    const context = await setupProduct();
    const post = await createFeedbackPost({
      productId: context.product.id,
      boardId: context.board.id,
      title: "Dark mode",
      body: "Please add dark mode for the dashboard.",
    });
    const conversation = await seedWidgetQuestion(
      context,
      "Could you add dark mode?",
    );

    const offered = await maybeOfferFeedbackCard({
      conversation,
      question: "Could you add dark mode?",
    });
    expect(offered.offered).toBe(true);
    expect(offered.card?.kind).toBe("vote");
    expect(offered.card?.feedbackPostId).toBe(post.id);

    const guest = await respondToFeedbackCard({
      actionId: offered.card!.id,
      conversationId: conversation.id,
      customerId: context.customer.id,
      isGuest: true,
      decision: "confirm",
    });
    expect(guest.ok).toBe(false);
    expect(
      await db
        .select()
        .from(feedbackCustomerVotes)
        .where(eq(feedbackCustomerVotes.feedbackPostId, post.id)),
    ).toHaveLength(0);

    const member = await respondToFeedbackCard({
      actionId: offered.card!.id,
      conversationId: conversation.id,
      customerId: context.customer.id,
      isGuest: false,
      decision: "confirm",
    });
    expect(member.ok).toBe(true);

    const votes = await db
      .select()
      .from(feedbackCustomerVotes)
      .where(eq(feedbackCustomerVotes.feedbackPostId, post.id));
    expect(votes).toHaveLength(1);
    const followers = await db
      .select()
      .from(feedbackFollowers)
      .where(eq(feedbackFollowers.feedbackPostId, post.id));
    expect(followers).toHaveLength(1);
  });

  isolatedTest("stops offering new requests after the per-conversation limit", async () => {
    const context = await setupProduct();
    const conversation = await seedWidgetQuestion(context, "Can you add exports?");

    for (let index = 0; index < 3; index += 1) {
      await db.insert(junoFeedbackActions).values({
        conversationId: conversation.id,
        productId: context.product.id,
        customerId: context.customer.id,
        kind: "create",
        status: "confirmed",
        query: "Can you add exports?",
        title: `Export request ${index}`,
        body: "Please add exports.",
        confirmedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });
    }

    const offered = await maybeOfferFeedbackCard({
      conversation,
      question: "Can you add another export format?",
    });
    expect(offered.offered).toBe(false);
  });
});

describe("guardrails and redaction", () => {
  isolatedTest("personal data never reaches the model or the audit row", async () => {
    const context = await setupProduct();
    await upload(
      context,
      "# Exporting\n\nOpen Settings, choose Export, then CSV. The download starts immediately.",
    );
    const conversation = await seedWidgetQuestion(
      context,
      "My email is ada@example.test and my card is 4111 1111 1111 1111. How do I export a CSV?",
    );

    let prompt = "";
    const outcome = await answerConversation({
      conversationId: conversation.id,
      productId: context.product.id,
      deps: {
        generate: async (input) => {
          prompt = `${input.system}\n${input.prompt}`;
          return "Open Settings, choose Export, then CSV.";
        },
      },
    });
    expect(outcome.status).toBe("answered");
    expect(prompt).not.toContain("ada@example.test");
    expect(prompt).not.toContain("4111 1111 1111 1111");

    const [answer] = await db
      .select()
      .from(junoAnswers)
      .where(eq(junoAnswers.conversationId, conversation.id));
    expect(answer?.question).toContain("[email]");
    expect(answer?.question).toContain("[card]");
    expect(answer?.promptVersion).toBe(JUNO_PROMPT_VERSION);

    const [audit] = await db
      .select()
      .from(junoRedactionEvents)
      .where(eq(junoRedactionEvents.productId, context.product.id));
    expect(audit).toMatchObject({ emailCount: 1, cardCount: 1 });
    expect(JSON.stringify(audit)).not.toContain("ada@example.test");
  });

  isolatedTest("a thumbs-down opens one source task, and repeated clicks do not duplicate it", async () => {
    const context = await setupProduct();
    await upload(
      context,
      "# Exporting\n\nOpen Settings, choose Export, then CSV. The download starts immediately.",
    );
    const conversation = await seedWidgetQuestion(context, "How do I export a CSV?");
    const answered = await answerConversation({
      conversationId: conversation.id,
      productId: context.product.id,
      deps: { generate: async () => "Open Settings, choose Export, then CSV." },
    });
    expect(answered.status).toBe("answered");

    const [answer] = await db
      .select({ id: junoAnswers.id })
      .from(junoAnswers)
      .where(eq(junoAnswers.conversationId, conversation.id));
    expect(answer?.id).toBeTruthy();

    for (let click = 0; click < 2; click += 1) {
      const rated = await rateJunoAnswer({
        productId: context.product.id,
        answerId: answer!.id,
        userId: context.user.id,
        rating: "down",
      });
      expect(rated.ok).toBe(true);
    }

    const tasks = await listOpenKnowledgeTasks(context.product.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.question).toContain("export");
    const rows = await db
      .select()
      .from(junoKnowledgeTasks)
      .where(eq(junoKnowledgeTasks.productId, context.product.id));
    expect(rows).toHaveLength(1);
  });
});

describe("activity meter", () => {
  isolatedTest("a settings or permission change hands off before generation", async () => {
    const context = await setupProduct();
    const conversation = await seedWidgetQuestion(
      context,
      "Please make me an admin on this workspace.",
    );

    let calls = 0;
    const outcome = await answerConversation({
      conversationId: conversation.id,
      productId: context.product.id,
      deps: {
        generate: async () => {
          calls += 1;
          return "Done.";
        },
      },
    });
    expect(outcome).toMatchObject({ status: "handoff", reason: "account" });
    expect(calls).toBe(0);
  });

  isolatedTest("counts handoffs, reasons, cost and resolutions without a team reply", async () => {
    const context = await setupProduct();
    await upload(
      context,
      "# Exporting\n\nOpen Settings, choose Export, then CSV. The download starts immediately.",
    );

    const billing = await seedWidgetQuestion(
      context,
      "I was charged twice. Can I get a refund?",
    );
    const handoff = await answerConversation({
      conversationId: billing.id,
      productId: context.product.id,
      deps: { generate: async () => "Should not run." },
    });
    expect(handoff.status).toBe("handoff");

    const answered = await seedWidgetQuestion(context, "How do I export a CSV?");
    const result = await answerConversation({
      conversationId: answered.id,
      productId: context.product.id,
      deps: { generate: async () => "Open Settings, choose Export, then CSV." },
    });
    expect(result.status).toBe("answered");

    const now = new Date();
    await db
      .update(junoConversations)
      .set({ state: "resolved", resolvedAt: now, lastJunoMessageAt: now })
      .where(eq(junoConversations.conversationId, answered.id));

    const activity = await getJunoActivity(context.product.id, { now });
    expect(activity.answers).toBe(2);
    expect(activity.handoffs).toBe(1);
    expect(activity.handoffReasons[0]).toMatchObject({ reason: "billing", count: 1 });
    expect(activity.resolved).toBe(1);
    expect(activity.resolvedWithoutTeam).toBe(1);
    expect(activity.costCents).toBe(1);
    expect(activity.costPerResolvedCents).toBe(1);
  });
});

describe("evaluation gate", () => {
  isolatedTest("a model change is refused until the golden set passes", async () => {
    const context = await setupProduct();
    const added = await addEvalCase({
      productId: context.product.id,
      userId: context.user.id,
      question: "How do I invite a teammate?",
      expectedKeywords: ["invite"],
      expectHandoff: false,
    });
    expect(added.ok).toBe(true);

    const blocked = await saveJunoSettings(
      settingsInput(context.product.id, { model: "test-model" }),
    );
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toContain("evaluation");

    const run = await runJunoEvaluation({
      productId: context.product.id,
      generate: async () => "Invite a teammate from Team settings.",
      retrieve: async () => [chunk()],
    });
    expect(run.ok).toBe(true);
    if (run.ok) {
      expect(run.summary.total).toBe(1);
      expect(run.summary.failed).toBe(0);
      expect(run.summary.model).toBe("test-model");
    }

    const saved = await saveJunoSettings(
      settingsInput(context.product.id, { model: "test-model" }),
    );
    expect(saved.ok).toBe(true);

    const status = await listEvalStatus(context.product.id);
    expect(status[0]?.passed).toBe(true);

    const [caseRow] = await db
      .select()
      .from(junoEvalCases)
      .where(eq(junoEvalCases.productId, context.product.id));
    const removed = await removeEvalCase({
      productId: context.product.id,
      caseId: caseRow!.id,
    });
    expect(removed.ok).toBe(true);
  });
});

describe("auxiliary AI", () => {
  isolatedTest("stores tag suggestions and assisted duplicates without applying them", async () => {
    const context = await setupProduct();
    const post = await createFeedbackPost({
      productId: context.product.id,
      boardId: context.board.id,
      title: "Dark mode for the dashboard",
      body: "Please add dark mode to the dashboard.",
    });
    await createBoardTag(context.board.id, context.product.id, { name: "Billing" });
    await createBoardTag(context.board.id, context.product.id, { name: "Dark mode" });

    const tags = await suggestTagsForPost({
      productId: context.product.id,
      feedbackPostId: post.id,
      generate: async () => "1. Dark mode, made-up",
    });
    expect(tags).toEqual({ status: "suggested", tags: ["Dark mode"] });

    const duplicate = await createFeedbackPost({
      productId: context.product.id,
      boardId: context.board.id,
      title: "Dark mode for dashboard",
      body: "A dark mode for the dashboard would help.",
    });
    const duplicates = await suggestDuplicatesForPost({
      productId: context.product.id,
      feedbackPostId: post.id,
    });
    expect(duplicates.status).toBe("suggested");
    expect(duplicates.matches?.some((match) => match.id === duplicate.id)).toBe(true);

    const suggestions = await listRecentSuggestions(context.product.id);
    expect(suggestions.length).toBeGreaterThanOrEqual(2);

    // Nothing was applied: the request has no tag links and is not merged.
    const [stored] = await db
      .select()
      .from(feedbackPosts)
      .where(eq(feedbackPosts.id, post.id));
    expect(stored?.mergedIntoId).toBeNull();

    const zero = await saveJunoSettings(
      settingsInput(context.product.id, { dailyBudgetCents: 0 }),
    );
    expect(zero.ok).toBe(true);
    const skipped = await suggestTagsForPost({
      productId: context.product.id,
      feedbackPostId: post.id,
      generate: async () => "Dark mode",
    });
    expect(skipped).toEqual({ status: "skipped", reason: "budget" });

    const all = await db
      .select()
      .from(junoSuggestions)
      .where(eq(junoSuggestions.productId, context.product.id));
    expect(all).toHaveLength(2);
  });
});
