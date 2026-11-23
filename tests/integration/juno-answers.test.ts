import { afterAll, beforeAll, describe, expect } from "bun:test";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  conversationMessages,
  conversations,
} from "@/db/schema/conversations";
import {
  junoAnswers,
  junoConversations,
  junoUsage,
} from "@/db/schema/knowledge";
import { getConversationThread } from "@/features/conversations/queries";
import { appendTeamMessage } from "@/features/conversations/service";
import { answerConversation } from "@/features/juno/answer";
import { sweepJunoAutoResolve } from "@/features/juno/automation";
import { handToJuno } from "@/features/juno/schedule";
import { ensureJunoSettings, saveJunoSettings } from "@/features/juno/settings";
import { createUploadSource } from "@/features/juno/sources";

import {
  createConversation,
  createConversationMessage,
  createCustomer,
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
 * Juno answers against real Postgres.
 *
 * The model is injected, so these tests prove the wiring around it: retrieval
 * must clear the floor, billing/account questions never reach generation, the
 * daily budget is a hard stop, citations are stored on the message and exposed
 * to the team, a human reply pauses Juno until it is handed back, and the
 * auto-resolve sweep respects the chat/email timers and team activity.
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
  delete process.env.AI_API_URL;
  delete process.env.AI_API_KEY;
  // The budget tests inject `generate`, so no request leaves the process; a
  // model name is still required so the per-answer cost estimate is non-zero.
  process.env.AI_MODEL = "gpt-4o-mini";
  process.env.AI_API_URL = "http://127.0.0.1:9/v1";
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

async function setupProduct(
  options: {
    enabled?: boolean;
    floor?: number;
    budget?: number;
  } = {},
) {
  // Juno is a paid AI capability; the plan allowlist is part of the answer gate.
  const workspace = await createWorkspace({ plan: "pro" });
  const product = await createProduct(workspace.id);
  const customer = await createCustomer(workspace.id, {
    name: "Ada Lovelace",
    email: "ada@example.test",
  });
  const { user } = await createMember(workspace.id, { role: "admin" });

  await ensureJunoSettings(product.id);
  const saved = await saveJunoSettings({
    productId: product.id,
    enabled: options.enabled ?? true,
    duplicateMode: "assisted",
    submissionAssistantEnabled: false,
    tone: "warm",
    replyLength: "short",
    formality: "neutral",
    emoji: false,
    language: "auto",
    model: "",
    confidenceFloor: options.floor ?? 0.05,
    dailyBudgetCents: options.budget ?? 100,
    autoResolveChatMinutes: 30,
    autoResolveEmailMinutes: 4320,
  });
  if (!saved.ok) throw new Error(saved.error);

  return { workspace, product, customer, user };
}

async function upload(
  context: Awaited<ReturnType<typeof setupProduct>>,
  content: string,
  name = "Help center",
): Promise<void> {
  const result = await createUploadSource({
    workspaceId: context.workspace.id,
    productId: context.product.id,
    userId: context.user.id,
    name,
    filename: "help.md",
    mimeType: "text/markdown",
    content,
  });
  if (!result.ok) throw new Error(result.error);
}

async function seedQuestion(
  context: Awaited<ReturnType<typeof setupProduct>>,
  question: string,
  createdAt = new Date(),
) {
  const conversation = await createConversation({
    workspaceId: context.workspace.id,
    productId: context.product.id,
    customerId: context.customer.id,
    subject: "Support request",
    lastMessageAt: createdAt,
  });
  await createConversationMessage({
    conversation,
    authorType: "customer",
    body: question,
    createdAt,
  });
  return conversation;
}

async function stateFor(conversationId: string) {
  const rows = await db
    .select()
    .from(junoConversations)
    .where(eq(junoConversations.conversationId, conversationId))
    .limit(1);
  return rows[0] ?? null;
}

describe("answer pipeline", () => {
  isolatedTest("a covered question is answered with visible citations", async () => {
    const context = await setupProduct();
    await upload(
      context,
      "# Exporting\n\nOpen Settings, choose Export, then CSV. The download starts immediately.",
    );
    const conversation = await seedQuestion(context, "How do I export a CSV?");

    const now = new Date("2026-11-04T12:00:00.000Z");
    let calls = 0;
    const outcome = await answerConversation({
      conversationId: conversation.id,
      productId: context.product.id,
      deps: {
        now,
        generate: async () => {
          calls += 1;
          return "Open Settings, choose Export, then CSV.";
        },
      },
    });

    expect(outcome.status).toBe("answered");
    expect(calls).toBe(1);

    const thread = await getConversationThread({
      productId: context.product.id,
      conversationId: conversation.id,
      userId: context.user.id,
    });
    const junoMessage = thread?.messages.find((message) => message.authorType === "juno");
    expect(junoMessage?.body).toContain("Export");
    expect(junoMessage?.citations?.[0]?.sourceName).toBe("Help center");
    expect(thread?.juno?.state).toBe("active");

    const answers = await db
      .select()
      .from(junoAnswers)
      .where(eq(junoAnswers.conversationId, conversation.id));
    expect(answers[0]?.status).toBe("answered");
    expect(answers[0]?.confidence ?? 0).toBeGreaterThan(0.05);
    expect(answers[0]?.citations?.length).toBeGreaterThan(0);

    const usage = await db
      .select()
      .from(junoUsage)
      .where(
        and(
          eq(junoUsage.productId, context.product.id),
          eq(junoUsage.day, now.toISOString().slice(0, 10)),
        ),
      );
    expect(usage[0]?.requests).toBe(1);
  });

  isolatedTest("an uncovered question hands off without calling the model", async () => {
    const context = await setupProduct({ floor: 0.95 });
    await upload(context, "# Exporting\n\nOpen Settings, choose Export, then CSV.");
    const conversation = await seedQuestion(
      context,
      "Do you offer a SAML single sign-on integration?",
    );

    let calls = 0;
    const outcome = await answerConversation({
      conversationId: conversation.id,
      productId: context.product.id,
      deps: {
        generate: async () => {
          calls += 1;
          return "A guess.";
        },
      },
    });

    expect(outcome.status).toBe("handoff");
    expect(["knowledge_gap", "low_confidence"]).toContain(outcome.reason ?? "");
    expect(calls).toBe(0);

    const thread = await getConversationThread({
      productId: context.product.id,
      conversationId: conversation.id,
      userId: context.user.id,
    });
    const notes = thread?.messages.filter((message) => message.kind === "note") ?? [];
    expect(notes).toHaveLength(1);
    expect(notes[0]?.body ?? "").toContain("handed off");
    expect(thread?.juno?.state).toBe("handed_off");

    const [conversationRow] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversation.id));
    expect(conversationRow?.status).toBe("queue");
    expect(conversationRow?.unreadForTeam).toBeGreaterThan(0);
  });

  isolatedTest("billing questions hand off before generation", async () => {
    const context = await setupProduct();
    await upload(context, "# Billing\n\nInvoices live under Billing.");
    const conversation = await seedQuestion(
      context,
      "I was charged twice. Can I get a refund on my invoice?",
    );

    let calls = 0;
    const outcome = await answerConversation({
      conversationId: conversation.id,
      productId: context.product.id,
      deps: {
        generate: async () => {
          calls += 1;
          return "Here is your refund.";
        },
      },
    });

    expect(outcome).toMatchObject({ status: "handoff", reason: "billing" });
    expect(calls).toBe(0);

    const thread = await getConversationThread({
      productId: context.product.id,
      conversationId: conversation.id,
      userId: context.user.id,
    });
    const publicMessage = thread?.messages.find((message) => message.authorType === "juno");
    expect(publicMessage?.body).toContain("billing");
  });

  isolatedTest("account questions hand off before generation", async () => {
    const context = await setupProduct();
    const conversation = await seedQuestion(
      context,
      "Please delete my account and all personal data.",
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

  isolatedTest("a disabled toggle stops new pickups entirely", async () => {
    const context = await setupProduct({ enabled: false });
    await upload(context, "# Exporting\n\nOpen Settings, choose Export, then CSV.");
    const conversation = await seedQuestion(context, "How do I export a CSV?");

    const outcome = await answerConversation({
      conversationId: conversation.id,
      productId: context.product.id,
    });
    expect(outcome).toEqual({ status: "skipped", reason: "disabled" });

    const messages = await db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversation.id));
    expect(messages.filter((message) => message.authorType === "juno")).toHaveLength(0);
  });

  isolatedTest("the daily budget hands off instead of degrading silently", async () => {
    const context = await setupProduct({ budget: 1 });
    await upload(context, "# Exporting\n\nOpen Settings, choose Export, then CSV.");
    const conversation = await seedQuestion(context, "How do I export a CSV?");
    const now = new Date("2026-11-04T12:00:00.000Z");

    await db.insert(junoUsage).values({
      productId: context.product.id,
      day: now.toISOString().slice(0, 10),
      requests: 1,
      costCents: 5,
    });

    let calls = 0;
    const outcome = await answerConversation({
      conversationId: conversation.id,
      productId: context.product.id,
      deps: {
        now,
        generate: async () => {
          calls += 1;
          return "Still here.";
        },
      },
    });

    expect(outcome).toMatchObject({ status: "handoff", reason: "budget" });
    expect(calls).toBe(0);
  });

  isolatedTest("crossing 80% records one daily budget alert", async () => {
    const context = await setupProduct({ budget: 5 });
    await upload(context, "# Exporting\n\nOpen Settings, choose Export, then CSV.");
    const conversation = await seedQuestion(context, "How do I export a CSV?");
    const now = new Date("2026-11-04T12:00:00.000Z");

    await db.insert(junoUsage).values({
      productId: context.product.id,
      day: now.toISOString().slice(0, 10),
      requests: 1,
      costCents: 3,
    });

    const outcome = await answerConversation({
      conversationId: conversation.id,
      productId: context.product.id,
      deps: { now, generate: async () => "Open Settings, choose Export, then CSV." },
    });
    expect(outcome.status).toBe("answered");

    const [usage] = await db
      .select()
      .from(junoUsage)
      .where(
        and(
          eq(junoUsage.productId, context.product.id),
          eq(junoUsage.day, now.toISOString().slice(0, 10)),
        ),
      );
    expect(usage?.costCents).toBe(4);
    expect(usage?.alertedAt).toBeInstanceOf(Date);
  });
});

describe("human takeover", () => {
  isolatedTest("a team reply pauses Juno until the thread is handed back", async () => {
    const context = await setupProduct();
    await upload(
      context,
      "# Exporting\n\nOpen Settings, choose Export, then CSV. The download starts immediately.",
    );
    const conversation = await seedQuestion(context, "How do I export a CSV?");

    const reply = await appendTeamMessage({
      productId: context.product.id,
      conversationId: conversation.id,
      userId: context.user.id,
      body: "A human is looking at this now.",
    });
    expect(reply.ok).toBe(true);
    expect((await stateFor(conversation.id))?.state).toBe("paused");

    await createConversationMessage({
      conversation,
      authorType: "customer",
      body: "How do I export a CSV?",
      createdAt: new Date(Date.now() + 1_000),
    });

    let calls = 0;
    const skipped = await answerConversation({
      conversationId: conversation.id,
      productId: context.product.id,
      deps: {
        generate: async () => {
          calls += 1;
          return "Should not run.";
        },
      },
    });
    expect(skipped).toEqual({ status: "skipped", reason: "state" });
    expect(calls).toBe(0);

    const handed = await handToJuno({
      productId: context.product.id,
      conversationId: conversation.id,
      userId: context.user.id,
    });
    expect(handed.ok).toBe(true);
    expect((await stateFor(conversation.id))?.state).toBe("active");

    const answered = await answerConversation({
      conversationId: conversation.id,
      productId: context.product.id,
      deps: {
        generate: async () => "Open Settings, choose Export, then CSV.",
      },
    });
    expect(answered.status).toBe("answered");
  });
});

describe("auto-resolve timers", () => {
  isolatedTest("a chat thread resolves after its silence window", async () => {
    const context = await setupProduct();
    await upload(
      context,
      "# Exporting\n\nOpen Settings, choose Export, then CSV. The download starts immediately.",
    );
    const now = new Date("2026-11-04T12:00:00.000Z");
    const conversation = await createConversation({
      workspaceId: context.workspace.id,
      productId: context.product.id,
      customerId: context.customer.id,
      status: "queue",
      lastMessageAt: new Date(now.getTime() - 40 * 60_000),
    });
    await createConversationMessage({
      conversation,
      authorType: "customer",
      body: "How do I export a CSV?",
      createdAt: new Date(now.getTime() - 40 * 60_000),
    });
    await db.insert(junoConversations).values({
      conversationId: conversation.id,
      productId: context.product.id,
      state: "active",
      lastJunoMessageAt: new Date(now.getTime() - 31 * 60_000),
      updatedAt: new Date(now.getTime() - 31 * 60_000),
    });

    const result = await sweepJunoAutoResolve({ now });
    expect(result.resolved).toBe(1);

    const [after] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversation.id));
    expect(after?.status).toBe("resolved");
    expect((await stateFor(conversation.id))?.state).toBe("resolved");

    // A new customer reply reopens the thread and Juno picks it up again.
    await createConversationMessage({
      conversation: { ...conversation, ...after! },
      authorType: "customer",
      body: "How do I export a CSV?",
      createdAt: new Date(now.getTime() + 60_000),
    });
    await db
      .update(conversations)
      .set({
        status: "queue",
        lastCustomerMessageAt: new Date(now.getTime() + 60_000),
      })
      .where(eq(conversations.id, conversation.id));

    const answered = await answerConversation({
      conversationId: conversation.id,
      productId: context.product.id,
      deps: {
        now: new Date(now.getTime() + 2 * 60_000),
        generate: async () => "Open Settings, choose Export, then CSV.",
      },
    });
    expect(answered.status).toBe("answered");
  });

  isolatedTest("an email thread keeps its longer silence window", async () => {
    const context = await setupProduct();
    const now = new Date("2026-11-04T12:00:00.000Z");

    const create = async (minutesAgo: number) => {
      const conversation = await createConversation({
        workspaceId: context.workspace.id,
        productId: context.product.id,
        customerId: context.customer.id,
        status: "queue",
        lastMessageAt: new Date(now.getTime() - minutesAgo * 60_000),
      });
      await db
        .update(conversations)
        .set({ sourceContext: { channel: "email" } })
        .where(eq(conversations.id, conversation.id));
      await db.insert(junoConversations).values({
        conversationId: conversation.id,
        productId: context.product.id,
        state: "active",
        lastJunoMessageAt: new Date(now.getTime() - minutesAgo * 60_000),
        updatedAt: new Date(now.getTime() - minutesAgo * 60_000),
      });
      return conversation;
    };

    const fresh = await create(120);
    const old = await create(73 * 60);

    const result = await sweepJunoAutoResolve({ now });
    expect(result.resolved).toBe(1);

    const [freshRow] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, fresh.id));
    const [oldRow] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, old.id));
    expect(freshRow?.status).toBe("queue");
    expect(oldRow?.status).toBe("resolved");
  });

  isolatedTest("a team-touched thread never auto-resolves", async () => {
    const context = await setupProduct();
    const now = new Date("2026-11-04T12:00:00.000Z");
    const conversation = await createConversation({
      workspaceId: context.workspace.id,
      productId: context.product.id,
      customerId: context.customer.id,
      status: "open",
      lastMessageAt: new Date(now.getTime() - 60 * 60_000),
    });
    await createConversationMessage({
      conversation,
      authorType: "customer",
      body: "How do I export a CSV?",
      createdAt: new Date(now.getTime() - 60 * 60_000),
    });
    await createConversationMessage({
      conversation,
      authorType: "team",
      authorUserId: context.user.id,
      body: "I am on it.",
      createdAt: new Date(now.getTime() - 50 * 60_000),
    });
    await db.insert(junoConversations).values({
      conversationId: conversation.id,
      productId: context.product.id,
      state: "active",
      lastJunoMessageAt: new Date(now.getTime() - 55 * 60_000),
      updatedAt: new Date(now.getTime() - 55 * 60_000),
    });

    const result = await sweepJunoAutoResolve({ now });
    expect(result.resolved).toBe(0);

    const [after] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversation.id));
    expect(after?.status).toBe("open");
  });
});

describe("provider outage", () => {
  isolatedTest(
    "a timed-out provider hands off without leaving a generated message",
    async () => {
      const context = await setupProduct();
      await upload(
        context,
        "# Exporting\n\nOpen Settings, choose Export, then CSV. The download starts immediately.",
      );
      const conversation = await seedQuestion(context, "How do I export a CSV?");

      // A real HTTP server that never finishes inside AI_TIMEOUT_MS. The
      // adapter is the production one; only the endpoint and the timeout are
      // test configuration.
      const server = Bun.serve({
        port: 0,
        async fetch() {
          await new Promise((resolve) => setTimeout(resolve, 1_500));
          return Response.json({
            choices: [{ message: { content: "This draft must never be stored." } }],
          });
        },
      });

      const previousEnv = {
        AI_API_URL: process.env.AI_API_URL,
        AI_API_KEY: process.env.AI_API_KEY,
        AI_MODEL: process.env.AI_MODEL,
        AI_TIMEOUT_MS: process.env.AI_TIMEOUT_MS,
      };
      process.env.AI_API_URL = `http://127.0.0.1:${server.port}/v1`;
      process.env.AI_MODEL = "timeout-model";
      process.env.AI_TIMEOUT_MS = "100";
      delete process.env.AI_API_KEY;

      try {
        const started = performance.now();
        const outcome = await answerConversation({
          conversationId: conversation.id,
          productId: context.product.id,
        });
        expect(performance.now() - started).toBeLessThan(5_000);

        expect(outcome.status).toBe("handoff");
        expect(outcome.reason).toBe("unavailable");

        const messages = await db
          .select()
          .from(conversationMessages)
          .where(eq(conversationMessages.conversationId, conversation.id));

        // Exactly one customer-visible Juno message: the handoff notice. The
        // provider's text never became a message, so there is no orphan draft
        // for a teammate to find and accidentally send.
        const junoMessages = messages.filter((message) => message.authorType === "juno");
        expect(junoMessages).toHaveLength(1);
        expect(junoMessages[0]?.body).not.toContain("must never be stored");
        expect(
          messages.some(
            (message) => message.authorType === "system" && message.kind === "note",
          ),
        ).toBe(true);

        const answers = await db
          .select()
          .from(junoAnswers)
          .where(eq(junoAnswers.conversationId, conversation.id));
        expect(answers).toHaveLength(1);
        expect(answers[0]?.status).toBe("handoff");
        expect(answers[0]?.handoffReason).toBe("unavailable");
        expect(answers[0]?.model).toBeNull();
      } finally {
        for (const [key, value] of Object.entries(previousEnv)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
        server.stop(true);
      }
    },
    60_000,
  );
});
