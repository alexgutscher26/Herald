import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  boards,
  feedbackPosts,
  products,
  slackIntegrations,
  slackRequestLinks,
  workspaces,
} from "@/db/schema";
import { enqueueJob } from "@/features/jobs/queue";
import { logEvent, serializeError } from "@/lib/logger";

import { publicRequestUrl } from "./service";

/** Human labels used in the Slack thread, matching the dashboard wording. */
export function statusLabel(status: string): string {
  switch (status) {
    case "under_review":
      return "Under review";
    case "in_progress":
      return "In progress";
    case "open":
      return "Open";
    case "planned":
      return "Planned";
    case "shipped":
      return "Shipped";
    case "closed":
      return "Closed";
    default:
      return status;
  }
}

/**
 * Queue a thread reply for a status transition.
 *
 * Called after the status write commits. Missing Slack links are normal (most
 * requests do not come from Slack), so this is best-effort and never fails the
 * dashboard or API mutation.
 */
export async function queueSlackStatusUpdate(input: {
  requestId: string;
  status: string;
}): Promise<void> {
  try {
    const rows = await db
      .select({
        title: feedbackPosts.title,
        updatedAt: feedbackPosts.updatedAt,
        teamId: slackRequestLinks.teamId,
        channelId: slackRequestLinks.channelId,
        messageTs: slackRequestLinks.messageTs,
        workspaceSlug: workspaces.slug,
        productSlug: products.slug,
        boardSlug: boards.slug,
      })
      .from(slackRequestLinks)
      .innerJoin(feedbackPosts, eq(slackRequestLinks.requestId, feedbackPosts.id))
      .innerJoin(products, eq(feedbackPosts.productId, products.id))
      .innerJoin(workspaces, eq(products.workspaceId, workspaces.id))
      .innerJoin(boards, eq(feedbackPosts.boardId, boards.id))
      .innerJoin(
        slackIntegrations,
        and(
          eq(slackIntegrations.teamId, slackRequestLinks.teamId),
          eq(slackIntegrations.channelId, slackRequestLinks.channelId),
          eq(slackIntegrations.active, true),
        ),
      )
      .where(eq(slackRequestLinks.requestId, input.requestId))
      .limit(1);
    const row = rows[0];
    if (!row) return;

    const url = publicRequestUrl({
      workspaceSlug: row.workspaceSlug,
      productSlug: row.productSlug,
      boardSlug: row.boardSlug,
      requestId: input.requestId,
    });
    const text = `*<${url}|${row.title}>* is now *${statusLabel(input.status)}*.`;

    await enqueueJob({
      type: "slack_status_update",
      payload: {
        teamId: row.teamId,
        channelId: row.channelId,
        threadTs: row.messageTs,
        text,
      },
      dedupeKey: `slack-status:${input.requestId}:${input.status}:${row.updatedAt.toISOString()}`,
    });
  } catch (error) {
    logEvent("warn", "slack.status_enqueue_failed", {
      requestId: input.requestId,
      error: serializeError(error),
    });
  }
}
