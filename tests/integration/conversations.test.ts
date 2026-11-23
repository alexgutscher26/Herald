import { afterAll, beforeAll, describe, expect } from "bun:test";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  conversationAttachments,
  conversationMessages,
  conversationParticipants,
  conversations,
} from "@/db/schema/conversations";
import { blockedCustomers } from "@/db/schema/feedback-extensions";
import type { InboxFilters, ConversationView } from "@/features/conversations/filters";
import {
  getConversationThread,
  listConversations,
  listDueReminders,
  markConversationRead,
} from "@/features/conversations/queries";
import {
  appendTeamMessage,
  assignConversation,
  blockConversationSender,
  bulkSetConversationStatus,
  completeConversationReminder,
  setConversationReminder,
  setConversationStatus,
  snoozeConversation,
} from "@/features/conversations/service";

import {
  createConversation,
  createConversationMessage,
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
 * Conversations against real Postgres.
 *
 * The server actions' authorization is covered by the shared authz helpers;
 * these tests exercise the product-scoped service and query layer they call,
 * including the invariants the inbox depends on: view membership, search,
 * previews, unread counts, product scoping and the partial unique indexes.
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
  const product = await createProduct(workspace.id);
  const customer = await createCustomer(workspace.id, {
    name: "Ada Lovelace",
    email: "ada@example.test",
  });
  return { workspace, product, customer };
}

function filters(overrides: Partial<InboxFilters> = {}): InboxFilters {
  return { view: "queue", query: "", assignee: "any", ...overrides };
}

async function idsFor(input: {
  productId: string;
  view: ConversationView;
  now: Date;
  query?: string;
}): Promise<string[]> {
  const { items } = await listConversations({
    productId: input.productId,
    userId: "usr_viewer",
    filters: filters({
      view: input.view,
      query: input.query ?? "",
    }),
    now: input.now,
  });
  return items.map((item) => item.id).sort();
}

function sorted(ids: string[]): string[] {
  return [...ids].sort();
}

describe("conversation inbox", () => {
  isolatedTest("views separate the working inbox from spam and archived", async () => {
    const { workspace, product, customer } = await tenant();
    const now = new Date("2026-11-04T12:00:00.000Z");

    const create = (status: Parameters<typeof createConversation>[0]["status"], extra = {}) =>
      createConversation({
        workspaceId: workspace.id,
        productId: product.id,
        customerId: customer.id,
        status,
        ...extra,
      });

    const queued = await create("queue", { unreadForTeam: 1 });
    const open = await create("open");
    const future = await create("snoozed", {
      snoozedUntil: new Date(now.getTime() + 60 * 60 * 1000),
    });
    const due = await create("snoozed", {
      snoozedUntil: new Date(now.getTime() - 60_000),
    });
    const resolved = await create("resolved");
    const spam = await create("spam");
    const archived = await create("archived");

    expect(await idsFor({ productId: product.id, view: "queue", now })).toEqual(
      sorted([queued.id, open.id, due.id]),
    );
    expect(await idsFor({ productId: product.id, view: "open", now })).toEqual([
      open.id,
    ]);
    expect(await idsFor({ productId: product.id, view: "all", now })).toEqual(
      sorted([queued.id, open.id, future.id, due.id, resolved.id]),
    );
    expect(await idsFor({ productId: product.id, view: "snoozed", now })).toEqual([
      future.id,
    ]);
    expect(await idsFor({ productId: product.id, view: "resolved", now })).toEqual([
      resolved.id,
    ]);
    expect(await idsFor({ productId: product.id, view: "spam", now })).toEqual([
      spam.id,
    ]);
    expect(await idsFor({ productId: product.id, view: "archived", now })).toEqual([
      archived.id,
    ]);

    const { counts } = await listConversations({
      productId: product.id,
      userId: "usr_viewer",
      filters: filters(),
      now,
    });
    expect(counts.queue).toBe(3);
    expect(counts.open).toBe(1);
    expect(counts.all).toBe(5);
    expect(counts.snoozed).toBe(1);
    expect(counts.resolved).toBe(1);
    expect(counts.spam).toBe(1);
    expect(counts.archived).toBe(1);
  });

  isolatedTest("search matches subject, customer and preview but never spam or archived", async () => {
    const { workspace, product, customer } = await tenant();
    const second = await createCustomer(workspace.id, {
      name: "Grace Hopper",
      email: "findme@example.test",
    });
    const now = new Date("2026-11-04T12:00:00.000Z");

    const active = await createConversation({
      workspaceId: workspace.id,
      productId: product.id,
      customerId: customer.id,
      subject: "Billing export fails",
      lastMessagePreview: "It happens every Monday.",
    });
    const spam = await createConversation({
      workspaceId: workspace.id,
      productId: product.id,
      customerId: customer.id,
      subject: "Billing export fails",
      status: "spam",
    });
    const archived = await createConversation({
      workspaceId: workspace.id,
      productId: product.id,
      customerId: customer.id,
      subject: "Billing export fails",
      status: "archived",
    });
    const byEmail = await createConversation({
      workspaceId: workspace.id,
      productId: product.id,
      customerId: second.id,
      subject: "Unrelated question",
    });

    expect(
      await idsFor({ productId: product.id, view: "all", now, query: "billing" }),
    ).toEqual([active.id]);
    expect(
      await idsFor({ productId: product.id, view: "all", now, query: "monday" }),
    ).toEqual([active.id]);
    expect(
      await idsFor({
        productId: product.id,
        view: "all",
        now,
        query: "findme@example.test",
      }),
    ).toEqual([byEmail.id]);

    // Spam is searchable inside its own tab, never from the main inbox.
    expect(
      await idsFor({ productId: product.id, view: "spam", now, query: "billing" }),
    ).toEqual([spam.id]);
    expect(
      await idsFor({ productId: product.id, view: "archived", now, query: "billing" }),
    ).toEqual([archived.id]);
  });

  isolatedTest("a team reply opens a queued thread, clears unread and updates the preview", async () => {
    const { workspace, product, customer } = await tenant();
    const member = await createMember(workspace.id, { role: "admin" });

    const conversation = await createConversation({
      workspaceId: workspace.id,
      productId: product.id,
      customerId: customer.id,
      subject: "Where is my export?",
      unreadForTeam: 2,
    });
    await createConversationMessage({
      conversation,
      authorType: "customer",
      body: "I still cannot download it.",
    });

    const result = await appendTeamMessage({
      productId: product.id,
      conversationId: conversation.id,
      userId: member.user.id,
      body: "We are on it.",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe("open");

    const rows = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversation.id));
    expect(rows[0]?.status).toBe("open");
    expect(rows[0]?.unreadForTeam).toBe(0);
    expect(rows[0]?.lastMessagePreview).toBe("We are on it.");

    const thread = await getConversationThread({
      productId: product.id,
      conversationId: conversation.id,
      userId: member.user.id,
    });
    expect(thread?.messages).toHaveLength(2);
    expect(thread?.messages.at(-1)).toMatchObject({
      kind: "message",
      authorType: "team",
      authorName: member.user.name,
      body: "We are on it.",
    });

    const participants = await db
      .select()
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conversation.id),
          eq(conversationParticipants.userId, member.user.id),
        ),
      );
    expect(participants).toHaveLength(1);
    expect(participants[0]?.lastReadAt).not.toBeNull();
  });

  isolatedTest("an internal note stays out of the status and the inbox preview", async () => {
    const { workspace, product, customer } = await tenant();
    const member = await createMember(workspace.id, { role: "admin" });

    const conversation = await createConversation({
      workspaceId: workspace.id,
      productId: product.id,
      customerId: customer.id,
      status: "queue",
      lastMessagePreview: "Customer question",
      unreadForTeam: 1,
    });

    const result = await appendTeamMessage({
      productId: product.id,
      conversationId: conversation.id,
      userId: member.user.id,
      body: "/note Billing is investigating this.",
    });
    expect(result.ok).toBe(true);

    const rows = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversation.id));
    expect(rows[0]?.status).toBe("queue");
    expect(rows[0]?.lastMessagePreview).toBe("Customer question");

    const thread = await getConversationThread({
      productId: product.id,
      conversationId: conversation.id,
      userId: member.user.id,
    });
    expect(thread?.messages.at(-1)).toMatchObject({
      kind: "note",
      body: "Billing is investigating this.",
    });

    const empty = await appendTeamMessage({
      productId: product.id,
      conversationId: conversation.id,
      userId: member.user.id,
      body: "/note",
    });
    expect(empty.ok).toBe(false);
  });

  isolatedTest("slash commands resolve, reopen and snooze without a second action", async () => {
    const { workspace, product, customer } = await tenant();
    const member = await createMember(workspace.id, { role: "admin" });
    const now = new Date("2026-11-04T12:00:00.000Z");
    const conversation = await createConversation({
      workspaceId: workspace.id,
      productId: product.id,
      customerId: customer.id,
    });

    const base = {
      productId: product.id,
      conversationId: conversation.id,
      userId: member.user.id,
      now,
    };

    expect((await appendTeamMessage({ ...base, body: "/resolve Fixed in 2.4" })).ok).toBe(
      true,
    );
    let rows = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversation.id));
    expect(rows[0]?.status).toBe("resolved");
    expect(rows[0]?.resolvedAt).not.toBeNull();
    expect(rows[0]?.lastMessagePreview).toBe("Fixed in 2.4");

    await appendTeamMessage({ ...base, body: "/reopen" });
    rows = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversation.id));
    expect(rows[0]?.status).toBe("open");
    expect(rows[0]?.resolvedAt).toBeNull();

    await appendTeamMessage({ ...base, body: "/snooze 2h" });
    rows = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversation.id));
    expect(rows[0]?.status).toBe("snoozed");
    expect(rows[0]?.snoozedUntil?.getTime()).toBe(now.getTime() + 120 * 60_000);

    const before = await db
      .select({ id: conversationMessages.id })
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversation.id));
    const invalid = await appendTeamMessage({ ...base, body: "/snooze 1m" });
    expect(invalid.ok).toBe(false);
    const after = await db
      .select({ id: conversationMessages.id })
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversation.id));
    expect(after).toHaveLength(before.length);
  });

  isolatedTest("snoozing hides a thread from Queue until its deadline passes", async () => {
    const { workspace, product, customer } = await tenant();
    const now = new Date("2026-11-04T12:00:00.000Z");
    const conversation = await createConversation({
      workspaceId: workspace.id,
      productId: product.id,
      customerId: customer.id,
    });

    const snoozed = await snoozeConversation({
      productId: product.id,
      conversationId: conversation.id,
      minutes: 60,
      now,
    });
    expect(snoozed.ok).toBe(true);

    expect(
      await idsFor({ productId: product.id, view: "queue", now }),
    ).toEqual([]);
    expect(
      await idsFor({
        productId: product.id,
        view: "queue",
        now: new Date(now.getTime() + 2 * 60 * 60 * 1000),
      }),
    ).toEqual([conversation.id]);
  });

  isolatedTest("restoring a spam or archived thread returns it to the working inbox", async () => {
    const { workspace, product, customer } = await tenant();
    const now = new Date("2026-11-04T12:00:00.000Z");
    const create = (status: Parameters<typeof createConversation>[0]["status"], subject: string) =>
      createConversation({
        workspaceId: workspace.id,
        productId: product.id,
        customerId: customer.id,
        status,
        subject,
      });

    const spam = await create("spam", "Billing credit repair offer");
    const archived = await create("archived", "Billing question from last year");

    // Both stay out of Queue and out of main-inbox search until restored.
    expect(await idsFor({ productId: product.id, view: "queue", now })).toEqual([]);
    expect(
      await idsFor({ productId: product.id, view: "all", now, query: "billing" }),
    ).toEqual([]);

    expect(
      (await setConversationStatus({
        productId: product.id,
        conversationId: spam.id,
        status: "open",
        now,
      })).ok,
    ).toBe(true);
    expect(
      (await setConversationStatus({
        productId: product.id,
        conversationId: archived.id,
        status: "open",
        now,
      })).ok,
    ).toBe(true);

    expect(
      await idsFor({ productId: product.id, view: "queue", now }),
    ).toEqual(sorted([spam.id, archived.id]));
    // Restored rows are searchable again and have left their old tabs.
    expect(
      await idsFor({ productId: product.id, view: "all", now, query: "billing" }),
    ).toEqual(sorted([spam.id, archived.id]));
    expect(await idsFor({ productId: product.id, view: "spam", now })).toEqual([]);
    expect(await idsFor({ productId: product.id, view: "archived", now })).toEqual([]);
  });

  isolatedTest("opening a thread clears unread and records one participant", async () => {
    const { workspace, product, customer } = await tenant();
    const member = await createMember(workspace.id, { role: "admin" });
    const conversation = await createConversation({
      workspaceId: workspace.id,
      productId: product.id,
      customerId: customer.id,
      unreadForTeam: 4,
    });

    await markConversationRead({
      productId: product.id,
      conversationId: conversation.id,
      userId: member.user.id,
    });
    await markConversationRead({
      productId: product.id,
      conversationId: conversation.id,
      userId: member.user.id,
    });

    const rows = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversation.id));
    expect(rows[0]?.unreadForTeam).toBe(0);

    const participants = await db
      .select()
      .from(conversationParticipants)
      .where(eq(conversationParticipants.conversationId, conversation.id));
    expect(participants).toHaveLength(1);
  });
});

describe("conversation mutations", () => {
  isolatedTest("a thread's messages and attachments never leak into another product", async () => {
    const a = await tenant();
    const b = await tenant();
    const conversation = await createConversation({
      workspaceId: a.workspace.id,
      productId: a.product.id,
      customerId: a.customer.id,
      subject: "With a log attached",
    });
    await createConversationMessage({
      conversation,
      authorType: "customer",
      body: "Console log attached.",
    });
    const [attachment] = await db
      .insert(conversationAttachments)
      .values({
        conversationId: conversation.id,
        productId: a.product.id,
        kind: "file",
        storageKey: uniqueLabel("attachments/log"),
        filename: "console.txt",
        mimeType: "text/plain",
        sizeBytes: 128,
      })
      .returning();
    if (!attachment) throw new Error("Attachment insert returned no row.");

    const thread = await getConversationThread({
      productId: a.product.id,
      conversationId: conversation.id,
      userId: "usr_viewer",
    });
    expect(thread?.messages).toHaveLength(1);
    expect(thread?.attachments).toHaveLength(1);
    expect(thread?.attachments[0]).toMatchObject({
      id: attachment.id,
      filename: "console.txt",
      kind: "file",
    });

    // The same ids from another product resolve to no thread at all.
    expect(
      await getConversationThread({
        productId: b.product.id,
        conversationId: conversation.id,
        userId: "usr_viewer",
      }),
    ).toBeNull();
  });

  isolatedTest("a message cannot be filed under another product", async () => {
    const a = await tenant();
    const b = await tenant();
    const member = await createMember(a.workspace.id, { role: "admin" });
    const conversation = await createConversation({
      workspaceId: a.workspace.id,
      productId: a.product.id,
      customerId: a.customer.id,
    });

    // The composite foreign key rejects the row instead of trusting productId.
    await expect(
      (async () => {
        await db.insert(conversationMessages).values({
          conversationId: conversation.id,
          productId: b.product.id,
          authorType: "team",
          authorUserId: member.user.id,
          body: "Wrong tenant",
        });
      })(),
    ).rejects.toThrow();
  });

  isolatedTest("an attachment cannot be filed under another product", async () => {
    const a = await tenant();
    const b = await tenant();
    const conversation = await createConversation({
      workspaceId: a.workspace.id,
      productId: a.product.id,
      customerId: a.customer.id,
    });

    await expect(
      (async () => {
        await db.insert(conversationAttachments).values({
          conversationId: conversation.id,
          productId: b.product.id,
          storageKey: uniqueLabel("attachments/wrong"),
          filename: "wrong.txt",
          mimeType: "text/plain",
          sizeBytes: 10,
        });
      })(),
    ).rejects.toThrow();
  });

  isolatedTest("status writes and the thread read are scoped to the product", async () => {
    const a = await tenant();
    const b = await tenant();
    const now = new Date("2026-11-04T12:00:00.000Z");

    const conversationA = await createConversation({
      workspaceId: a.workspace.id,
      productId: a.product.id,
      customerId: a.customer.id,
    });
    const conversationB = await createConversation({
      workspaceId: b.workspace.id,
      productId: b.product.id,
      customerId: b.customer.id,
      subject: "Tenant B billing",
    });

    const bulk = await bulkSetConversationStatus({
      productId: a.product.id,
      conversationIds: [conversationA.id, conversationB.id],
      status: "resolved",
      now,
    });
    expect(bulk.updated).toBe(1);

    const bRows = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationB.id));
    expect(bRows[0]?.status).toBe("queue");

    const crossStatus = await setConversationStatus({
      productId: a.product.id,
      conversationId: conversationB.id,
      status: "spam",
    });
    expect(crossStatus.ok).toBe(false);

    expect(
      await getConversationThread({
        productId: a.product.id,
        conversationId: conversationB.id,
        userId: "usr_viewer",
      }),
    ).toBeNull();
  });

  isolatedTest("assignment requires a workspace member and stays inside the product", async () => {
    const a = await tenant();
    const b = await tenant();
    const member = await createMember(a.workspace.id, { role: "admin" });
    const conversation = await createConversation({
      workspaceId: a.workspace.id,
      productId: a.product.id,
      customerId: a.customer.id,
    });
    const foreign = await createConversation({
      workspaceId: b.workspace.id,
      productId: b.product.id,
      customerId: b.customer.id,
    });

    const assigned = await assignConversation({
      productId: a.product.id,
      workspaceId: a.workspace.id,
      conversationId: conversation.id,
      assigneeId: member.user.id,
    });
    expect(assigned.ok).toBe(true);

    const rows = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversation.id));
    expect(rows[0]?.assigneeId).toBe(member.user.id);

    const notMember = await assignConversation({
      productId: a.product.id,
      workspaceId: a.workspace.id,
      conversationId: conversation.id,
      assigneeId: "usr_not_a_member",
    });
    expect(notMember.ok).toBe(false);

    const crossTenant = await assignConversation({
      productId: a.product.id,
      workspaceId: a.workspace.id,
      conversationId: foreign.id,
      assigneeId: member.user.id,
    });
    expect(crossTenant.ok).toBe(false);
  });

  isolatedTest("blocking a sender records the block once and moves the thread to spam", async () => {
    const { workspace, product, customer } = await tenant();
    const member = await createMember(workspace.id, { role: "admin" });
    const conversation = await createConversation({
      workspaceId: workspace.id,
      productId: product.id,
      customerId: customer.id,
    });

    const first = await blockConversationSender({
      productId: product.id,
      workspaceId: workspace.id,
      conversationId: conversation.id,
      userId: member.user.id,
    });
    expect(first.ok).toBe(true);

    const second = await blockConversationSender({
      productId: product.id,
      workspaceId: workspace.id,
      conversationId: conversation.id,
      userId: member.user.id,
    });
    expect(second.ok).toBe(true);

    const rows = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversation.id));
    expect(rows[0]?.status).toBe("spam");

    const blocks = await db
      .select()
      .from(blockedCustomers)
      .where(eq(blockedCustomers.customerId, customer.id));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.workspaceId).toBe(workspace.id);
  });

  isolatedTest("reminders are personal, become due once and can be reset", async () => {
    const { workspace, product, customer } = await tenant();
    const owner = await createMember(workspace.id, { role: "admin" });
    const other = await createMember(workspace.id, { role: "admin" });
    const now = new Date("2026-11-04T12:00:00.000Z");

    const conversation = await createConversation({
      workspaceId: workspace.id,
      productId: product.id,
      customerId: customer.id,
    });

    const created = await setConversationReminder({
      productId: product.id,
      conversationId: conversation.id,
      userId: owner.user.id,
      remindAt: new Date(now.getTime() + 60 * 60 * 1000),
      now,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(
      await listDueReminders({
        productId: product.id,
        userId: owner.user.id,
        now: new Date(now.getTime() + 2 * 60 * 60 * 1000),
      }),
    ).toEqual([
      {
        id: created.data.reminderId,
        conversationId: conversation.id,
        subject: conversation.subject,
        remindAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      },
    ]);

    expect(
      await listDueReminders({
        productId: product.id,
        userId: other.user.id,
        now: new Date(now.getTime() + 2 * 60 * 60 * 1000),
      }),
    ).toEqual([]);

    const past = await setConversationReminder({
      productId: product.id,
      conversationId: conversation.id,
      userId: owner.user.id,
      remindAt: new Date(now.getTime() - 60_000),
      now,
    });
    expect(past.ok).toBe(false);

    const completed = await completeConversationReminder({
      userId: owner.user.id,
      reminderId: created.data.reminderId,
      now,
    });
    expect(completed.updated).toBe(1);
    expect(
      await listDueReminders({
        productId: product.id,
        userId: owner.user.id,
        now: new Date(now.getTime() + 2 * 60 * 60 * 1000),
      }),
    ).toEqual([]);

    // The partial unique index is freed after completion, so a new reminder is
    // allowed on the same thread and user.
    const again = await setConversationReminder({
      productId: product.id,
      conversationId: conversation.id,
      userId: owner.user.id,
      remindAt: new Date(now.getTime() + 3 * 60 * 60 * 1000),
      now,
    });
    expect(again.ok).toBe(true);

    const foreign = await tenant();
    const crossProduct = await setConversationReminder({
      productId: foreign.product.id,
      conversationId: conversation.id,
      userId: owner.user.id,
      remindAt: new Date(now.getTime() + 60 * 60 * 1000),
      now,
    });
    expect(crossProduct.ok).toBe(false);
  });
});
