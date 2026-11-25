import "server-only";

import { and, asc, eq, gte, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { boards } from "@/db/schema/boards";
import {
  conversationMessages,
  conversations,
} from "@/db/schema/conversations";
import { customers } from "@/db/schema/customers";
import { feedbackPosts } from "@/db/schema/feedback";
import {
  feedbackCustomerVotes,
  feedbackFollowers,
} from "@/db/schema/feedback-extensions";
import {
  junoFeedbackActions,
  junoSettings,
} from "@/db/schema/knowledge";
import { products, workspaces } from "@/db/schema/workspaces";
import { publicSurfaceEnabled } from "@/features/entitlements/entitlements";
import { createPublicRequest } from "@/features/public/engagement";
import { latestPostModerationSql } from "@/features/public/queries";
import { resolvePublicBoard } from "@/features/public/resolver";
import { logEvent, serializeError } from "@/lib/logger";

import {
  deriveRequestTitle,
  FEEDBACK_CARD_TTL_MINUTES,
  isFeedbackIntent,
  MAX_CREATES_PER_CONVERSATION,
  MAX_CREATES_PER_WORKSPACE_DAY,
  MAX_VOTES_PER_CONVERSATION,
} from "./feedback-policy";
import { lexicalScore } from "./text";

/**
 * Feedback cards.
 *
 * Mira may search public requests and offer to file, vote or follow, but it
 * never acts until the customer confirms the card. The offer is a row with
 * `pending` status; confirmation claims that row first, so a double click
 * cannot create two requests. Creations go through `createPublicRequest`, which
 * means the board's approval queue, sensitive-content checks and follower
 * rules apply exactly as they do to a form submission.
 */

export {
  FEEDBACK_CARD_TTL_MINUTES,
  MAX_CREATES_PER_CONVERSATION,
  MAX_CREATES_PER_WORKSPACE_DAY,
  MAX_VOTES_PER_CONVERSATION,
  deriveRequestTitle,
  isFeedbackIntent,
} from "./feedback-policy";

export type JunoFeedbackCard = {
  id: string;
  kind: "create" | "vote" | "follow";
  title: string;
  query: string;
  expiresAt: string;
  feedbackPostId: string | null;
};

export type FeedbackActionResult =
  | {
      ok: true;
      status: "confirmed" | "declined";
      feedbackPostId?: string;
      message?: string;
    }
  | { ok: false; error: string };

function visibilitySql() {
  const latest = latestPostModerationSql();
  const requireApproval = sql<string>`coalesce(${boards.settings} #>> '{moderation,requireApproval}', 'none')`;
  return sql`case when ${requireApproval} = 'none' then ${latest} is distinct from 'rejected' else ${latest} = 'approved' end`;
}

async function searchPublicRequests(productId: string, query: string) {
  const rows = await db
    .select({
      id: feedbackPosts.id,
      title: feedbackPosts.title,
      body: feedbackPosts.body,
    })
    .from(feedbackPosts)
    .innerJoin(boards, eq(feedbackPosts.boardId, boards.id))
    .innerJoin(products, eq(feedbackPosts.productId, products.id))
    .where(
      and(
        eq(feedbackPosts.productId, productId),
        eq(products.publicFeedbackEnabled, true),
        eq(boards.visibility, "public"),
        isNull(boards.archivedAt),
        isNull(feedbackPosts.hiddenAt),
        isNull(feedbackPosts.mergedIntoId),
        visibilitySql(),
      ),
    )
    .limit(300);

  return rows
    .map((row) => ({
      ...row,
      score: lexicalScore(query, `${row.title}\n${row.body}`),
    }))
    .filter((row) => row.score >= 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

async function confirmedCounts(conversationId: string) {
  const rows = await db
    .select({
      kind: junoFeedbackActions.kind,
      count: sql<number>`count(*)::int`,
    })
    .from(junoFeedbackActions)
    .where(
      and(
        eq(junoFeedbackActions.conversationId, conversationId),
        eq(junoFeedbackActions.status, "confirmed"),
      ),
    )
    .groupBy(junoFeedbackActions.kind);

  const byKind = new Map(rows.map((row) => [row.kind, row.count]));
  return {
    creates: byKind.get("create") ?? 0,
    votes: (byKind.get("vote") ?? 0) + (byKind.get("follow") ?? 0),
  };
}

async function workspaceCreatesToday(workspaceId: string, now: Date) {
  const dayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const rows = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(junoFeedbackActions)
    .innerJoin(products, eq(junoFeedbackActions.productId, products.id))
    .where(
      and(
        eq(products.workspaceId, workspaceId),
        eq(junoFeedbackActions.kind, "create"),
        eq(junoFeedbackActions.status, "confirmed"),
        gte(junoFeedbackActions.confirmedAt, dayStart),
      ),
    );
  return rows[0]?.value ?? 0;
}

/**
 * Offer one card after an answer. Best-effort: a card failure must never turn
 * a delivered answer into an error.
 */
export async function maybeOfferFeedbackCard(input: {
  conversation: typeof conversations.$inferSelect;
  question: string;
  now?: Date;
}): Promise<{ offered: boolean; card?: JunoFeedbackCard }> {
  const now = input.now ?? new Date();

  try {
    if (input.conversation.sourceContext?.channel !== "widget") {
      return { offered: false };
    }

    const settingsRows = await db
      .select({ enabled: junoSettings.enabled })
      .from(junoSettings)
      .where(eq(junoSettings.productId, input.conversation.productId))
      .limit(1);
    if (!settingsRows[0]?.enabled) return { offered: false };
    if (!isFeedbackIntent(input.question)) return { offered: false };

    const pending = await db
      .select({ id: junoFeedbackActions.id })
      .from(junoFeedbackActions)
      .where(
        and(
          eq(junoFeedbackActions.conversationId, input.conversation.id),
          eq(junoFeedbackActions.status, "pending"),
          gte(junoFeedbackActions.expiresAt, now),
        ),
      )
      .limit(1);
    if (pending[0]) return { offered: false };

    const counts = await confirmedCounts(input.conversation.id);
    if (counts.creates >= MAX_CREATES_PER_CONVERSATION) return { offered: false };
    if (counts.votes >= MAX_VOTES_PER_CONVERSATION) return { offered: false };

    const matches = await searchPublicRequests(
      input.conversation.productId,
      input.question,
    );
    const match = matches[0];
    const kind: "create" | "vote" = match ? "vote" : "create";

    if (kind === "create") {
      const today = await workspaceCreatesToday(input.conversation.workspaceId, now);
      if (today >= MAX_CREATES_PER_WORKSPACE_DAY) return { offered: false };
    }

    const title = match?.title ?? deriveRequestTitle(input.question);
    const expiresAt = new Date(now.getTime() + FEEDBACK_CARD_TTL_MINUTES * 60_000);

    const inserted = await db
      .insert(junoFeedbackActions)
      .values({
        conversationId: input.conversation.id,
        productId: input.conversation.productId,
        customerId: input.conversation.customerId,
        kind,
        status: "pending",
        query: input.question.slice(0, 4_000),
        title,
        body: match?.body ?? input.question.slice(0, 5_000),
        feedbackPostId: match?.id ?? null,
        expiresAt,
        createdAt: now,
      })
      .returning({ id: junoFeedbackActions.id });

    const action = inserted[0];
    if (!action) return { offered: false };

    return {
      offered: true,
      card: {
        id: action.id,
        kind,
        title,
        query: input.question,
        expiresAt: expiresAt.toISOString(),
        feedbackPostId: match?.id ?? null,
      },
    };
  } catch (error) {
    logEvent("warn", "juno.feedback_card_failed", { error: serializeError(error) });
    return { offered: false };
  }
}

export async function loadPendingFeedbackCard(
  conversationId: string,
  now: Date = new Date(),
): Promise<JunoFeedbackCard | null> {
  const rows = await db
    .select()
    .from(junoFeedbackActions)
    .where(
      and(
        eq(junoFeedbackActions.conversationId, conversationId),
        eq(junoFeedbackActions.status, "pending"),
        gte(junoFeedbackActions.expiresAt, now),
      ),
    )
    .orderBy(asc(junoFeedbackActions.createdAt))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    title: row.title ?? deriveRequestTitle(row.query),
    query: row.query,
    expiresAt: row.expiresAt.toISOString(),
    feedbackPostId: row.feedbackPostId,
  };
}

async function postIsPublic(productId: string, postId: string): Promise<boolean> {
  const rows = await db
    .select({ id: feedbackPosts.id })
    .from(feedbackPosts)
    .innerJoin(boards, eq(feedbackPosts.boardId, boards.id))
    .where(
      and(
        eq(feedbackPosts.id, postId),
        eq(feedbackPosts.productId, productId),
        eq(boards.visibility, "public"),
        isNull(boards.archivedAt),
        isNull(feedbackPosts.hiddenAt),
        isNull(feedbackPosts.mergedIntoId),
        visibilitySql(),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function messageCustomer(input: {
  conversation: typeof conversations.$inferSelect;
  body: string;
  now: Date;
}): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(conversationMessages).values({
      conversationId: input.conversation.id,
      productId: input.conversation.productId,
      authorType: "system",
      kind: "message",
      channel: "widget",
      body: input.body,
      createdAt: input.now,
    });
    await tx
      .update(conversations)
      .set({
        lastMessagePreview: input.body.slice(0, 160),
        lastMessageAt: input.now,
        unreadForCustomer: sql`${conversations.unreadForCustomer} + 1`,
        updatedAt: input.now,
      })
      .where(eq(conversations.id, input.conversation.id));
  });
}

export async function respondToFeedbackCard(input: {
  actionId: string;
  conversationId: string;
  customerId: string;
  isGuest: boolean;
  decision: "confirm" | "decline";
  now?: Date;
}): Promise<FeedbackActionResult> {
  const now = input.now ?? new Date();

  const rows = await db
    .select({
      action: junoFeedbackActions,
      conversation: conversations,
      customerName: customers.name,
      workspaceSlug: workspaces.slug,
      productSlug: products.slug,
      workspaceId: products.workspaceId,
      plan: workspaces.plan,
    })
    .from(junoFeedbackActions)
    .innerJoin(
      conversations,
      eq(junoFeedbackActions.conversationId, conversations.id),
    )
    .innerJoin(customers, eq(junoFeedbackActions.customerId, customers.id))
    .innerJoin(products, eq(junoFeedbackActions.productId, products.id))
    .innerJoin(workspaces, eq(products.workspaceId, workspaces.id))
    .where(
      and(
        eq(junoFeedbackActions.id, input.actionId),
        eq(junoFeedbackActions.conversationId, input.conversationId),
        eq(junoFeedbackActions.customerId, input.customerId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return { ok: false, error: "That card is no longer available." };

  const action = row.action;
  if (action.status !== "pending") {
    return { ok: false, error: "That card was already handled." };
  }
  if (action.expiresAt.getTime() < now.getTime()) {
    await db
      .update(junoFeedbackActions)
      .set({ status: "expired", error: "The offer expired." })
      .where(
        and(
          eq(junoFeedbackActions.id, action.id),
          eq(junoFeedbackActions.status, "pending"),
        ),
      );
    return { ok: false, error: "That offer expired. Ask again if you still want it." };
  }

  if (input.decision === "decline") {
    const declined = await db
      .update(junoFeedbackActions)
      .set({ status: "declined", confirmedAt: now })
      .where(
        and(
          eq(junoFeedbackActions.id, action.id),
          eq(junoFeedbackActions.status, "pending"),
        ),
      )
      .returning({ id: junoFeedbackActions.id });
    if (declined.length === 0) {
      return { ok: false, error: "That card was already handled." };
    }
    return { ok: true, status: "declined" };
  }

  const counts = await confirmedCounts(input.conversationId);
  if (action.kind === "create") {
    if (counts.creates >= MAX_CREATES_PER_CONVERSATION) {
      return {
        ok: false,
        error: `A conversation can file at most ${MAX_CREATES_PER_CONVERSATION} new requests.`,
      };
    }
    if (
      (await workspaceCreatesToday(row.workspaceId, now)) >=
      MAX_CREATES_PER_WORKSPACE_DAY
    ) {
      return {
        ok: false,
        error: "This workspace reached its daily limit for new requests.",
      };
    }
  } else {
    if (input.isGuest) {
      return {
        ok: false,
        error: "Add and verify your email address to vote or follow a request.",
      };
    }
    if (counts.votes >= MAX_VOTES_PER_CONVERSATION) {
      return {
        ok: false,
        error: `A conversation can vote or follow at most ${MAX_VOTES_PER_CONVERSATION} requests.`,
      };
    }
  }

  // Claim first: a double confirmation cannot create or vote twice.
  const claimed = await db
    .update(junoFeedbackActions)
    .set({ status: "confirmed", confirmedAt: now })
    .where(
      and(
        eq(junoFeedbackActions.id, action.id),
        eq(junoFeedbackActions.status, "pending"),
      ),
    )
    .returning({ id: junoFeedbackActions.id });
  if (claimed.length === 0) {
    return { ok: false, error: "That card was already handled." };
  }

  const fail = async (error: string): Promise<FeedbackActionResult> => {
    await db
      .update(junoFeedbackActions)
      .set({ status: "failed", error: error.slice(0, 500) })
      .where(eq(junoFeedbackActions.id, action.id));
    return { ok: false, error };
  };

  try {
    let feedbackPostId = action.feedbackPostId;
    let message = "";

    if (action.kind === "create") {
      const boardRows = await db
        .select({ slug: boards.slug })
        .from(boards)
        .where(
          and(
            eq(boards.productId, action.productId),
            eq(boards.visibility, "public"),
            isNull(boards.archivedAt),
          ),
        )
        .orderBy(asc(boards.position))
        .limit(1);
      const boardSlug = boardRows[0]?.slug;
      if (!boardSlug) {
        return await fail("This product has no public board to file the request on.");
      }

      const tenant = await resolvePublicBoard({
        workspaceSlug: row.workspaceSlug,
        productSlug: row.productSlug,
        boardSlug,
      });
      if (!tenant || !publicSurfaceEnabled(tenant.workspace.plan)) {
        return await fail("Public feedback is not available for this product.");
      }
      if (input.isGuest && !tenant.board.guestPosting) {
        return await fail(
          "This board requires an email address before a request can be filed.",
        );
      }

      const created = await createPublicRequest({
        tenant,
        customerId: input.customerId,
        customerName: row.customerName,
        title: (action.title ?? deriveRequestTitle(action.query)).slice(0, 140),
        body: (action.body ?? action.query).slice(0, 5_000),
        category: "feature_request",
        files: [],
      });
      if (!created.ok) return await fail(created.error);

      feedbackPostId = created.id;
      message =
        created.status === "awaiting_review"
          ? `“${action.title}” is submitted and waiting for review.`
          : `Filed “${action.title}” on the board.`;
    } else {
      if (!feedbackPostId || !(await postIsPublic(action.productId, feedbackPostId))) {
        return await fail("That request is no longer public.");
      }

      if (action.kind === "vote") {
        await db
          .insert(feedbackCustomerVotes)
          .values({ feedbackPostId, customerId: input.customerId })
          .onConflictDoNothing();
      }
      await db
        .insert(feedbackFollowers)
        .values({
          feedbackPostId,
          customerId: input.customerId,
          source: "widget",
        })
        .onConflictDoNothing();

      message =
        action.kind === "vote"
          ? `Added your vote to “${action.title}”.`
          : `You’re following “${action.title}”.`;
    }

    await db
      .update(junoFeedbackActions)
      .set({ feedbackPostId })
      .where(eq(junoFeedbackActions.id, action.id));

    await messageCustomer({ conversation: row.conversation, body: message, now });

    return { ok: true, status: "confirmed", feedbackPostId: feedbackPostId ?? undefined, message };
  } catch (error) {
    logEvent("error", "juno.feedback_confirm_failed", {
      actionId: action.id,
      error: serializeError(error),
    });
    return await fail("Could not complete that request. Please try again.");
  }
}
