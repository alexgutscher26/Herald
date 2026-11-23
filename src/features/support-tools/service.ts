import "server-only";

import { randomBytes } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  boards,
  feedbackPosts,
  supportToolCaptures,
  supportToolConnections,
  type SupportToolProvider,
} from "@/db/schema";
import { recordWorkspaceAudit } from "@/features/data-controls/service";
import {
  checkWorkspaceLimit,
  workspaceIntegrationsOverLimit,
} from "@/features/entitlements/entitlements";
import { emitWebhookEvent } from "@/features/webhooks/service";
import { isValidEmail } from "@/lib/email";
import { getServerEnv } from "@/lib/env";
import { logEvent, serializeError } from "@/lib/logger";

import type { CapturedConversation } from "./capture";

export const SUPPORT_TOOL_LABELS: Record<SupportToolProvider, string> = {
  intercom: "Intercom",
  zendesk: "Zendesk",
};

export type SupportToolConnectionView = {
  id: string;
  provider: SupportToolProvider;
  providerLabel: string;
  name: string;
  boardId: string;
  boardName: string;
  webhookUrl: string;
  active: boolean;
  lastEventAt: string | null;
  lastError: string | null;
  updatedAt: string;
};

function webhookUrl(token: string): string {
  return `${getServerEnv().BETTER_AUTH_URL.replace(/\/+$/, "")}/api/integrations/support-tools/${token}`;
}

export async function listSupportToolConnections(
  productId: string,
): Promise<SupportToolConnectionView[]> {
  const rows = await db
    .select({
      connection: supportToolConnections,
      boardName: boards.name,
    })
    .from(supportToolConnections)
    .innerJoin(boards, eq(supportToolConnections.boardId, boards.id))
    .where(eq(supportToolConnections.productId, productId))
    .orderBy(asc(supportToolConnections.provider));

  return rows.map(({ connection, boardName }) => ({
    id: connection.id,
    provider: connection.provider,
    providerLabel: SUPPORT_TOOL_LABELS[connection.provider],
    name: connection.name,
    boardId: connection.boardId,
    boardName,
    webhookUrl: webhookUrl(connection.webhookToken),
    active: connection.active,
    lastEventAt: connection.lastEventAt?.toISOString() ?? null,
    lastError: connection.lastError,
    updatedAt: connection.updatedAt.toISOString(),
  }));
}

export async function listCaptureBoards(productId: string) {
  return db
    .select({ id: boards.id, name: boards.name, archivedAt: boards.archivedAt })
    .from(boards)
    .where(eq(boards.productId, productId))
    .orderBy(asc(boards.position), asc(boards.name));
}

export async function saveSupportToolConnection(input: {
  workspaceId: string;
  productId: string;
  userId: string;
  provider: SupportToolProvider;
  boardId: string;
  name?: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const boardRows = await db
    .select({ id: boards.id, name: boards.name, archivedAt: boards.archivedAt })
    .from(boards)
    .where(and(eq(boards.id, input.boardId), eq(boards.productId, input.productId)))
    .limit(1);
  const board = boardRows[0];
  if (!board) return { ok: false, error: "Choose a board in this product." };
  if (board.archivedAt) return { ok: false, error: "Choose an active board." };

  const existingRows = await db
    .select({ id: supportToolConnections.id, active: supportToolConnections.active })
    .from(supportToolConnections)
    .where(
      and(
        eq(supportToolConnections.productId, input.productId),
        eq(supportToolConnections.provider, input.provider),
        eq(supportToolConnections.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  const existing = existingRows[0];

  if (existing?.active && (await workspaceIntegrationsOverLimit(input.workspaceId))) {
    return {
      ok: false,
      error:
        "This workspace has more active integrations than its plan allows. Disconnect one before editing a connection.",
    };
  }

  if (!existing) {
    const limit = await checkWorkspaceLimit(input.workspaceId, "integrations");
    if (!limit.allowed) {
      return {
        ok: false,
        error:
          limit.limit === null
            ? "Your plan cannot add another integration."
            : `Your plan allows ${limit.limit} integration${limit.limit === 1 ? "" : "s"}. Upgrade to connect another.`,
      };
    }
  }

  const name = input.name?.trim().slice(0, 100) || SUPPORT_TOOL_LABELS[input.provider];
  if (existing) {
    await db
      .update(supportToolConnections)
      .set({
        name,
        boardId: board.id,
        active: true,
        updatedAt: new Date(),
      })
      .where(eq(supportToolConnections.id, existing.id));
    await recordWorkspaceAudit({
      workspaceId: input.workspaceId,
      actorUserId: input.userId,
      action: "integration.support_tool.connected",
      targetType: "support_tool_connection",
      targetId: existing.id,
      metadata: { provider: input.provider, board: board.id, updated: true },
    });
    return { ok: true, id: existing.id };
  }

  try {
    const inserted = await db
      .insert(supportToolConnections)
      .values({
        workspaceId: input.workspaceId,
        productId: input.productId,
        provider: input.provider,
        name,
        boardId: board.id,
        webhookToken: randomBytes(32).toString("base64url"),
        createdBy: input.userId,
      })
      .returning({ id: supportToolConnections.id });
    const id = inserted[0]?.id;
    if (!id) return { ok: false, error: "Could not save the capture connection." };

    await recordWorkspaceAudit({
      workspaceId: input.workspaceId,
      actorUserId: input.userId,
      action: "integration.support_tool.connected",
      targetType: "support_tool_connection",
      targetId: id,
      metadata: { provider: input.provider, board: board.id, updated: false },
    });
    return { ok: true, id };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "23505") {
      return { ok: false, error: "That support tool is already connected to this product." };
    }
    throw error;
  }
}

export async function disconnectSupportToolConnection(input: {
  workspaceId: string;
  productId: string;
  userId: string;
  provider: SupportToolProvider;
}): Promise<boolean> {
  const rows = await db
    .update(supportToolConnections)
    .set({ active: false, updatedAt: new Date() })
    .where(
      and(
        eq(supportToolConnections.productId, input.productId),
        eq(supportToolConnections.provider, input.provider),
        eq(supportToolConnections.workspaceId, input.workspaceId),
      ),
    )
    .returning({ id: supportToolConnections.id });
  const id = rows[0]?.id;
  if (!id) return false;

  await recordWorkspaceAudit({
    workspaceId: input.workspaceId,
    actorUserId: input.userId,
    action: "integration.support_tool.disconnected",
    targetType: "support_tool_connection",
    targetId: id,
    metadata: { provider: input.provider },
  });
  return true;
}

export async function rotateSupportToolWebhookToken(input: {
  workspaceId: string;
  productId: string;
  userId: string;
  provider: SupportToolProvider;
}): Promise<{ webhookUrl: string } | null> {
  const token = randomBytes(32).toString("base64url");
  const rows = await db
    .update(supportToolConnections)
    .set({ webhookToken: token, updatedAt: new Date() })
    .where(
      and(
        eq(supportToolConnections.productId, input.productId),
        eq(supportToolConnections.provider, input.provider),
        eq(supportToolConnections.workspaceId, input.workspaceId),
      ),
    )
    .returning({ id: supportToolConnections.id });
  const id = rows[0]?.id;
  if (!id) return null;

  await recordWorkspaceAudit({
    workspaceId: input.workspaceId,
    actorUserId: input.userId,
    action: "integration.support_tool.token_rotated",
    targetType: "support_tool_connection",
    targetId: id,
    metadata: { provider: input.provider },
  });
  return { webhookUrl: webhookUrl(token) };
}

export async function getSupportConnectionForWebhook(token: string) {
  const rows = await db
    .select()
    .from(supportToolConnections)
    .where(
      and(eq(supportToolConnections.webhookToken, token), eq(supportToolConnections.active, true)),
    )
    .limit(1);
  return rows[0] ?? null;
}

export type CaptureSupportResult =
  | { ok: true; requestId: string; created: boolean; duplicate: boolean }
  | { ok: false; error: string };

/**
 * Store one captured conversation as a request.
 *
 * `privacy = 'author'` is deliberate: support chats can contain addresses,
 * order numbers or internal details and must not become publicly readable just
 * because they were captured. A teammate triages the request and can widen it.
 */
export async function captureSupportConversation(input: {
  connection: typeof supportToolConnections.$inferSelect;
  conversation: CapturedConversation;
}): Promise<CaptureSupportResult> {
  const existingRows = await db
    .select({ feedbackPostId: supportToolCaptures.feedbackPostId })
    .from(supportToolCaptures)
    .where(
      and(
        eq(supportToolCaptures.connectionId, input.connection.id),
        eq(supportToolCaptures.externalId, input.conversation.externalId),
      ),
    )
    .limit(1);
  if (existingRows[0]?.feedbackPostId) {
    return {
      ok: true,
      requestId: existingRows[0].feedbackPostId,
      created: false,
      duplicate: true,
    };
  }

  const now = new Date();
  const createdAt =
    input.conversation.occurredAt &&
    input.conversation.occurredAt.getTime() <= now.getTime()
      ? input.conversation.occurredAt
      : now;
  const authorEmail =
    input.conversation.authorEmail && isValidEmail(input.conversation.authorEmail)
      ? input.conversation.authorEmail.slice(0, 254)
      : null;

  try {
    const result = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(feedbackPosts)
        .values({
          productId: input.connection.productId,
          boardId: input.connection.boardId,
          authorLabel: input.conversation.authorName?.slice(0, 120) || "Support conversation",
          authorEmail,
          title: input.conversation.title.slice(0, 200),
          body: input.conversation.body,
          category: "question",
          status: "open",
          source: "support",
          privacy: "author",
          createdAt,
          updatedAt: now,
        })
        .returning({ id: feedbackPosts.id });
      const post = inserted[0];
      if (!post) throw new Error("Captured request insert returned no row.");

      await tx.insert(supportToolCaptures).values({
        workspaceId: input.connection.workspaceId,
        productId: input.connection.productId,
        connectionId: input.connection.id,
        externalId: input.conversation.externalId,
        feedbackPostId: post.id,
        createdAt: now,
      });

      await tx
        .update(supportToolConnections)
        .set({ lastEventAt: now, lastError: null, updatedAt: now })
        .where(eq(supportToolConnections.id, input.connection.id));

      return post.id;
    });

    await emitWebhookEvent({
      workspaceId: input.connection.workspaceId,
      event: "request.created",
      data: {
        request_id: result,
        board_id: input.connection.boardId,
        title: input.conversation.title,
        status: "open",
        // Captured support content is author-private until a teammate widens it.
        visibility: "private",
        source: input.connection.provider,
      },
    });

    return { ok: true, requestId: result, created: true, duplicate: false };
  } catch (error) {
    // A provider retry can race the first webhook. Return the winner if the
    // unique capture row already exists; otherwise keep the error observable.
    const racedRows = await db
      .select({ feedbackPostId: supportToolCaptures.feedbackPostId })
      .from(supportToolCaptures)
      .where(
        and(
          eq(supportToolCaptures.connectionId, input.connection.id),
          eq(supportToolCaptures.externalId, input.conversation.externalId),
        ),
      )
      .limit(1);
    if (racedRows[0]?.feedbackPostId) {
      return {
        ok: true,
        requestId: racedRows[0].feedbackPostId,
        created: false,
        duplicate: true,
      };
    }

    const message = "The captured conversation could not be stored.";
    await db
      .update(supportToolConnections)
      .set({ lastError: message, updatedAt: new Date() })
      .where(eq(supportToolConnections.id, input.connection.id))
      .catch(() => undefined);
    logEvent("warn", "support_tool.capture_failed", {
      productId: input.connection.productId,
      provider: input.connection.provider,
      error: serializeError(error),
    });
    return { ok: false, error: message };
  }
}
