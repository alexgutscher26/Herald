import "server-only";

import { and, eq, gt, isNull } from "drizzle-orm";

import { db } from "@/db";
import {
  boards,
  feedbackPosts,
  products,
  slackIntegrations,
  slackOAuthStates,
  slackRequestLinks,
  workspaces,
} from "@/db/schema";
import { emitWebhookEvent } from "@/features/webhooks/service";
import { getServerEnv } from "@/lib/env";
import { logEvent, serializeError } from "@/lib/logger";

import { createSlackState, hashSlackState } from "./sign";
import { suggestSlackRequest } from "./suggest";

/**
 * Slack installation and request-origin services.
 *
 * Everything is scoped by workspace and product at the query level. The bot
 * token never leaves this server module: callers receive only channel/team
 * metadata, and the settings page never selects `access_token`.
 */

const INSTALL_STATE_TTL_MS = 10 * 60 * 1000;

export function publicRequestUrl(input: {
  workspaceSlug: string;
  productSlug: string;
  boardSlug: string;
  requestId: string;
}): string {
  const origin = getServerEnv().BETTER_AUTH_URL.replace(/\/+$/, "");
  return (
    `${origin}/p/${encodeURIComponent(input.workspaceSlug)}/` +
    `${encodeURIComponent(input.productSlug)}/${encodeURIComponent(input.boardSlug)}/` +
    `${encodeURIComponent(input.requestId)}`
  );
}

export async function createSlackInstallState(input: {
  workspaceId: string;
  productId: string;
  userId: string;
}): Promise<string> {
  const state = createSlackState();
  await db.insert(slackOAuthStates).values({
    stateHash: hashSlackState(state),
    workspaceId: input.workspaceId,
    productId: input.productId,
    userId: input.userId,
    expiresAt: new Date(Date.now() + INSTALL_STATE_TTL_MS),
  });
  return state;
}

export async function consumeSlackInstallState(rawState: string): Promise<{
  workspaceId: string;
  productId: string;
  workspaceSlug: string;
  productSlug: string;
  userId: string | null;
} | null> {
  const stateHash = hashSlackState(rawState);
  const consumed = await db
    .update(slackOAuthStates)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(slackOAuthStates.stateHash, stateHash),
        isNull(slackOAuthStates.usedAt),
        gt(slackOAuthStates.expiresAt, new Date()),
      ),
    )
    .returning({
      workspaceId: slackOAuthStates.workspaceId,
      productId: slackOAuthStates.productId,
      userId: slackOAuthStates.userId,
    });
  const row = consumed[0];
  if (!row) return null;

  const rows = await db
    .select({
      workspaceSlug: workspaces.slug,
      productSlug: products.slug,
      expiresAt: slackOAuthStates.expiresAt,
    })
    .from(slackOAuthStates)
    .innerJoin(workspaces, eq(slackOAuthStates.workspaceId, workspaces.id))
    .innerJoin(products, eq(slackOAuthStates.productId, products.id))
    .where(eq(slackOAuthStates.stateHash, stateHash))
    .limit(1);
  const joined = rows[0];
  if (!joined || joined.expiresAt.getTime() <= Date.now()) return null;

  return {
    workspaceId: row.workspaceId,
    productId: row.productId,
    userId: row.userId,
    workspaceSlug: joined.workspaceSlug,
    productSlug: joined.productSlug,
  };
}

export async function upsertSlackIntegration(input: {
  workspaceId: string;
  productId: string;
  userId: string | null;
  teamId: string;
  teamName: string;
  botUserId: string | null;
  accessToken: string;
  scopes: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const existing = await db
    .select({ id: slackIntegrations.id, teamId: slackIntegrations.teamId })
    .from(slackIntegrations)
    .where(eq(slackIntegrations.productId, input.productId))
    .limit(1);

  if (existing[0]) {
    await db
      .update(slackIntegrations)
      .set({
        workspaceId: input.workspaceId,
        teamId: input.teamId,
        teamName: input.teamName,
        botUserId: input.botUserId,
        accessToken: input.accessToken,
        scopes: input.scopes,
        active: true,
        installedBy: input.userId,
        // A reconnect to a different workspace must not keep a channel from
        // the previous team; the admin chooses a channel again.
        ...(existing[0].teamId === input.teamId
          ? {}
          : { channelId: null, channelName: null }),
        updatedAt: new Date(),
      })
      .where(eq(slackIntegrations.id, existing[0].id));
    return { ok: true, id: existing[0].id };
  }

  try {
    const inserted = await db
      .insert(slackIntegrations)
      .values({
        workspaceId: input.workspaceId,
        productId: input.productId,
        teamId: input.teamId,
        teamName: input.teamName,
        botUserId: input.botUserId,
        accessToken: input.accessToken,
        scopes: input.scopes,
        active: true,
        installedBy: input.userId,
      })
      .returning({ id: slackIntegrations.id });
    const id = inserted[0]?.id;
    if (!id) return { ok: false, error: "Could not save the Slack installation." };
    return { ok: true, id };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "23505") {
      return { ok: false, error: "That Slack channel is already connected to another product." };
    }
    throw error;
  }
}

export async function getSlackIntegration(productId: string) {
  const rows = await db
    .select({
      id: slackIntegrations.id,
      workspaceId: slackIntegrations.workspaceId,
      productId: slackIntegrations.productId,
      teamId: slackIntegrations.teamId,
      teamName: slackIntegrations.teamName,
      channelId: slackIntegrations.channelId,
      channelName: slackIntegrations.channelName,
      active: slackIntegrations.active,
      accessToken: slackIntegrations.accessToken,
      installedBy: slackIntegrations.installedBy,
      createdAt: slackIntegrations.createdAt,
      updatedAt: slackIntegrations.updatedAt,
    })
    .from(slackIntegrations)
    .where(eq(slackIntegrations.productId, productId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getSlackIntegrationForEvent(input: {
  teamId: string;
  channelId: string;
}) {
  const rows = await db
    .select()
    .from(slackIntegrations)
    .where(
      and(
        eq(slackIntegrations.teamId, input.teamId),
        eq(slackIntegrations.channelId, input.channelId),
        eq(slackIntegrations.active, true),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function saveSlackChannel(input: {
  productId: string;
  channelId: string;
  channelName: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const updated = await db
      .update(slackIntegrations)
      .set({
        channelId: input.channelId,
        channelName: input.channelName,
        active: true,
        updatedAt: new Date(),
      })
      .where(eq(slackIntegrations.productId, input.productId))
      .returning({ id: slackIntegrations.id });
    if (!updated[0]) return { ok: false, error: "Connect Slack before choosing a channel." };
    return { ok: true };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "23505") {
      return { ok: false, error: "That Slack channel is already connected to another product." };
    }
    throw error;
  }
}

export async function disconnectSlack(productId: string): Promise<boolean> {
  const rows = await db
    .update(slackIntegrations)
    .set({ active: false, channelId: null, channelName: null, updatedAt: new Date() })
    .where(eq(slackIntegrations.productId, productId))
    .returning({ id: slackIntegrations.id });
  return Boolean(rows[0]);
}

export type SlackRequestResult =
  | {
      ok: true;
      requestId: string;
      title: string;
      boardName: string;
      url: string;
      created: boolean;
      confirmationTs: string | null;
    }
  | { ok: false; error: string };

export async function createRequestFromSlack(input: {
  integration: typeof slackIntegrations.$inferSelect;
  teamId: string;
  channelId: string;
  messageTs: string;
  text: string;
  authorName: string;
  /** Slash commands have no source message to thread status updates under. */
  linkThread?: boolean;
}): Promise<SlackRequestResult> {
  const existing = await db
    .select({
      requestId: slackRequestLinks.requestId,
      confirmationTs: slackRequestLinks.confirmationTs,
    })
    .from(slackRequestLinks)
    .where(
      and(
        eq(slackRequestLinks.teamId, input.teamId),
        eq(slackRequestLinks.channelId, input.channelId),
        eq(slackRequestLinks.messageTs, input.messageTs),
      ),
    )
    .limit(1);

  if (existing[0]) {
    const row = await loadRequestContext(existing[0].requestId);
    if (!row) return { ok: false, error: "The original request no longer exists." };
    return {
      ok: true,
      requestId: row.id,
      title: row.title,
      boardName: row.boardName,
      url: publicRequestUrl(row),
      created: false,
      confirmationTs: existing[0].confirmationTs,
    };
  }

  const suggestion = await suggestSlackRequest({
    productId: input.integration.productId,
    text: input.text,
    authorName: input.authorName,
  });
  if (!suggestion) {
    return { ok: false, error: "This product has no active board to put the request on." };
  }

  const createdAt = new Date();
  let requestId: string;
  try {
    requestId = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(feedbackPosts)
        .values({
          productId: input.integration.productId,
          boardId: suggestion.boardId,
          // Slack feedback is team-sourced, not a customer request with a
          // verified email. The author label preserves who said it.
          source: "slack",
          authorLabel: input.authorName,
          title: suggestion.title,
          body: suggestion.body,
          category: suggestion.category,
          status: "open",
          createdAt,
          updatedAt: createdAt,
        })
        .returning({ id: feedbackPosts.id });
      const post = inserted[0];
      if (!post) throw new Error("Slack request insert returned no row.");

      if (input.linkThread !== false) {
        await tx.insert(slackRequestLinks).values({
          workspaceId: input.integration.workspaceId,
          productId: input.integration.productId,
          requestId: post.id,
          teamId: input.teamId,
          channelId: input.channelId,
          messageTs: input.messageTs,
        });
      }
      return post.id;
    });
  } catch (error) {
    logEvent("warn", "slack.request_insert_failed", {
      productId: input.integration.productId,
      error: serializeError(error),
    });
    return { ok: false, error: "Could not create the request from Slack." };
  }

  await emitWebhookEvent({
    workspaceId: input.integration.workspaceId,
    event: "request.created",
    data: {
      request_id: requestId,
      board_id: suggestion.boardId,
      title: suggestion.title,
      status: "open",
      visibility: "published",
      source: "slack",
    },
  });

  const row = await loadRequestContext(requestId);
  if (!row) return { ok: false, error: "The new request could not be read back." };
  return {
    ok: true,
    requestId: row.id,
    title: row.title,
    boardName: row.boardName,
    url: publicRequestUrl(row),
    created: true,
    confirmationTs: null,
  };
}

async function loadRequestContext(requestId: string) {
  const rows = await db
    .select({
      id: feedbackPosts.id,
      requestId: feedbackPosts.id,
      title: feedbackPosts.title,
      workspaceSlug: workspaces.slug,
      productSlug: products.slug,
      boardSlug: boards.slug,
      boardName: boards.name,
    })
    .from(feedbackPosts)
    .innerJoin(products, eq(feedbackPosts.productId, products.id))
    .innerJoin(workspaces, eq(products.workspaceId, workspaces.id))
    .innerJoin(boards, eq(feedbackPosts.boardId, boards.id))
    .where(eq(feedbackPosts.id, requestId))
    .limit(1);
  return rows[0] ?? null;
}

export async function markSlackConfirmation(input: {
  requestId: string;
  confirmationTs: string;
}): Promise<void> {
  await db
    .update(slackRequestLinks)
    .set({ confirmationTs: input.confirmationTs })
    .where(eq(slackRequestLinks.requestId, input.requestId));
}
