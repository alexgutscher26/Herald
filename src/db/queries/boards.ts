import "server-only";

import { and, asc, count, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { boards, feedbackPosts } from "@/db/schema";
import type { Board } from "@/db/schema/boards";
import type { BoardRecord } from "@/features/boards/types";

type BoardVisibility = Board["visibility"];

/**
 * Board reads for the dashboard.
 *
 * Every function takes a `productId` the caller already authorized. The
 * product constraint is part of the WHERE clause, so a board id from another
 * tenant can only ever return `null`/an empty list.
 */

function toRecord(
  row: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    icon: string | null;
    color: string | null;
    visibility: BoardVisibility;
    guestPosting: boolean;
    settings: BoardRecord["settings"];
    position: number;
    archivedAt: Date | null;
  },
  postCount: number,
): BoardRecord {
  return {
    ...row,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    postCount,
  };
}

/** Active boards first by position, then archived boards, for one product. */
export async function listBoardsForProduct(productId: string): Promise<BoardRecord[]> {
  const [rows, counts] = await Promise.all([
    db
      .select({
        id: boards.id,
        name: boards.name,
        slug: boards.slug,
        description: boards.description,
        icon: boards.icon,
        color: boards.color,
        visibility: boards.visibility,
        guestPosting: boards.guestPosting,
        settings: boards.settings,
        position: boards.position,
        archivedAt: boards.archivedAt,
      })
      .from(boards)
      .where(eq(boards.productId, productId))
      .orderBy(
        sql`CASE WHEN ${boards.archivedAt} IS NULL THEN 0 ELSE 1 END`,
        asc(boards.position),
        asc(boards.name),
      ),
    db
      .select({
        boardId: feedbackPosts.boardId,
        value: count(),
      })
      .from(feedbackPosts)
      .where(
        and(
          eq(feedbackPosts.productId, productId),
          isNull(feedbackPosts.archivedAt),
          isNull(feedbackPosts.mergedIntoId),
        ),
      )
      .groupBy(feedbackPosts.boardId),
  ]);

  const countsByBoard = new Map<string, number>();
  for (const row of counts) {
    if (row.boardId) countsByBoard.set(row.boardId, row.value);
  }

  return rows.map((row) => toRecord(row, countsByBoard.get(row.id) ?? 0));
}

/**
 * Resolve one board inside an already-authorized product.
 *
 * Returns the raw row because callers are server actions that need the current
 * values (including the archived flag) before writing.
 */
export async function findBoardForProduct(
  productId: string,
  boardId: string,
): Promise<Board | null> {
  const rows = await db
    .select()
    .from(boards)
    .where(and(eq(boards.id, boardId), eq(boards.productId, productId)))
    .limit(1);

  return rows[0] ?? null;
}
