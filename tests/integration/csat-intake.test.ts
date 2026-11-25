import { afterAll, beforeAll, describe, expect } from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { conversations } from "@/db/schema/conversations";
import { customers } from "@/db/schema/customers";
import {
  startCustomerConversation,
  submitCustomerCsat,
} from "@/features/conversations/customer";
import { setConversationStatus } from "@/features/conversations/service";
import {
  applyIntakeTraits,
  createIntakeQuestion,
  saveCsatSetting,
} from "@/features/conversations/support-settings";
import { createGuestCustomerSession } from "@/features/customer-session/session";
import { replaceBoardAccessRules } from "@/features/public/access";

import {
  createBoard,
  createConversation,
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
 * CSAT and structured intake against real Postgres.
 *
 * The trigger is the part worth proving: every resolution path (dashboard,
 * bulk, slash command, Mira) changes `conversations.status`, and the request
 * must be stamped once no matter which path did it.
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
  const session = await createGuestCustomerSession(workspace.id);
  const conversation = await createConversation({
    workspaceId: workspace.id,
    productId: product.id,
    customerId: session.active.customer.id,
  });
  return { workspace, product, session, conversation };
}

async function conversationRow(id: string) {
  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id));
  return rows[0];
}

describe("CSAT", () => {
  isolatedTest(
    "is off by default, requests once on resolution and accepts one rating",
    async () => {
      const { workspace, product, session, conversation } = await tenant();
      const base = { productId: product.id, conversationId: conversation.id };

      // Off by default: resolving does not create a request.
      await setConversationStatus({ ...base, status: "resolved" });
      expect((await conversationRow(conversation.id))?.csatRequestedAt).toBeNull();

      await setConversationStatus({ ...base, status: "open" });
      await saveCsatSetting({ productId: product.id, enabled: true });
      await setConversationStatus({ ...base, status: "resolved" });

      const first = await conversationRow(conversation.id);
      expect(first?.csatRequestedAt).not.toBeNull();

      // Reopening and resolving again never sends a second request.
      await setConversationStatus({ ...base, status: "open" });
      await setConversationStatus({ ...base, status: "resolved" });
      expect((await conversationRow(conversation.id))?.csatRequestedAt?.getTime()).toBe(
        first?.csatRequestedAt?.getTime(),
      );

      const rated = await submitCustomerCsat({
        workspaceSlug: workspace.slug,
        productSlug: product.slug,
        conversationId: conversation.id,
        rating: 5,
        sessionCookie: session.cookieValue,
      });
      expect(rated).toEqual({ state: "ready", rating: 5 });

      const stored = await conversationRow(conversation.id);
      expect(stored?.csatRating).toBe(5);
      expect(stored?.csatRatedAt).not.toBeNull();

      // A second rating is refused rather than overwriting the first.
      expect(
        await submitCustomerCsat({
          workspaceSlug: workspace.slug,
          productSlug: product.slug,
          conversationId: conversation.id,
          rating: 1,
          sessionCookie: session.cookieValue,
        }),
      ).toEqual({ state: "invalid", error: "This conversation already has a rating." });
      expect((await conversationRow(conversation.id))?.csatRating).toBe(5);
    },
  );

  isolatedTest("a foreign customer cannot rate someone else's thread", async () => {
    const { workspace, product, conversation } = await tenant();
    await saveCsatSetting({ productId: product.id, enabled: true });
    await setConversationStatus({
      productId: product.id,
      conversationId: conversation.id,
      status: "resolved",
    });

    const stranger = await createGuestCustomerSession(workspace.id);
    expect(
      await submitCustomerCsat({
        workspaceSlug: workspace.slug,
        productSlug: product.slug,
        conversationId: conversation.id,
        rating: 4,
        sessionCookie: stranger.cookieValue,
      }),
    ).toEqual({ state: "invalid", error: "This conversation is not waiting for a rating." });
    expect((await conversationRow(conversation.id))?.csatRating).toBeNull();
  });
});

describe("structured intake", () => {
  isolatedTest(
    "widget answers persist as traits and an unanswered guest still starts a thread",
    async () => {
      const workspace = await createWorkspace({ plan: "pro" });
      const product = await createProduct(workspace.id, { publicFeedbackEnabled: true });
      const session = await createGuestCustomerSession(workspace.id);

      const question = await createIntakeQuestion({
        productId: product.id,
        channel: "widget",
        key: "plan",
        label: "Which plan are you on?",
        kind: "select",
        options: ["Free", "Pro"],
      });
      expect(question.ok).toBe(true);

      const started = await startCustomerConversation({
        workspaceSlug: workspace.slug,
        productSlug: product.slug,
        body: "The export is empty.",
        intake: { plan: "Pro", severity: "high" },
        sessionCookie: session.cookieValue,
      });
      expect(started.state).toBe("ready");

      const [customer] = await db
        .select()
        .from(customers)
        .where(eq(customers.id, session.active.customer.id));
      // Unknown keys are not stored; the configured answer is.
      expect(customer?.traits).toMatchObject({ plan: "Pro" });
      expect(customer?.traits).not.toHaveProperty("severity");

      // A second visitor can still start a conversation without answering.
      const quiet = await createGuestCustomerSession(workspace.id);
      const unanswered = await startCustomerConversation({
        workspaceSlug: workspace.slug,
        productSlug: product.slug,
        body: "No answers from me.",
        sessionCookie: quiet.cookieValue,
      });
      expect(unanswered.state).toBe("ready");
    },
  );

  isolatedTest("a trait that gates a board cannot be collected publicly", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const product = await createProduct(workspace.id, { publicFeedbackEnabled: true });
    const board = await createBoard(product.id);

    // A gate written first blocks the question.
    expect(
      await replaceBoardAccessRules({
        productId: product.id,
        boardId: board.id,
        rules: [{ match: "trait", traitKey: "plan", value: "pro" }],
      }),
    ).toMatchObject({ ok: true });
    expect(
      await createIntakeQuestion({
        productId: product.id,
        channel: "board",
        boardId: board.id,
        key: "plan",
        label: "Which plan?",
        kind: "text",
      }),
    ).toMatchObject({ ok: false });

    // A question written first blocks a new gate on the same key.
    expect(
      await createIntakeQuestion({
        productId: product.id,
        channel: "widget",
        key: "use_case",
        label: "What are you building?",
        kind: "text",
      }),
    ).toMatchObject({ ok: true });
    expect(
      await replaceBoardAccessRules({
        productId: product.id,
        boardId: board.id,
        rules: [{ match: "trait", traitKey: "use_case", value: "analytics" }],
      }),
    ).toMatchObject({ ok: false });
  });

  isolatedTest("board questions stay on their board", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const product = await createProduct(workspace.id, { publicFeedbackEnabled: true });
    const session = await createGuestCustomerSession(workspace.id);
    const firstBoard = await createBoard(product.id);
    const secondBoard = await createBoard(product.id);

    expect(
      await createIntakeQuestion({
        productId: product.id,
        channel: "board",
        boardId: firstBoard.id,
        key: "severity",
        label: "How severe is it?",
        kind: "text",
      }),
    ).toMatchObject({ ok: true });

    await applyIntakeTraits({
      productId: product.id,
      channel: "board",
      boardId: firstBoard.id,
      customerId: session.active.customer.id,
      answers: { severity: "High" },
    });
    await applyIntakeTraits({
      productId: product.id,
      channel: "board",
      boardId: secondBoard.id,
      customerId: session.active.customer.id,
      answers: { severity: "Low" },
    });

    const [customer] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, session.active.customer.id));
    // The second board has no such question, so the first answer stands.
    expect(customer?.traits).toMatchObject({ severity: "High" });
  });
});
