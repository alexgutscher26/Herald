/**
 * Board backfill reconciliation.
 *
 * Migration `0003_jazzy_queen_noir.sql` gave every product a default `feedback`
 * board and assigned the existing feedback posts to it. This script re-checks
 * that invariant after the fact and can repair the two recoverable gaps:
 *
 *   - a product with no `feedback` board,
 *   - a feedback post whose `board_id` is null.
 *
 * A post that points at a board belonging to another product is not repaired:
 * that is a data-integrity conflict and needs a human decision.
 *
 * Usage:
 *   bun run db:reconcile-boards            # read-only report; exits 1 on drift
 *   bun run db:reconcile-boards --apply    # repair, then re-check in one transaction
 *
 * The report contains counts only — never product names, ids or customer data.
 */

import { Client } from "pg";

import { getDatabaseUrl } from "@/lib/env";

import { assertScriptEnvironment } from "./lib/guard";

assertScriptEnvironment("reconcile-board-backfill");

export type BoardBackfillReport = {
  products: number;
  boards: number;
  posts: number;
  /** Products with no board at all. */
  productsWithoutBoards: number;
  /** Products missing the default `feedback` slug. */
  productsWithoutDefaultBoard: number;
  postsWithoutBoard: number;
  /** A feedback post whose board belongs to a different product. */
  crossProductPosts: number;
  statusCounts: Record<string, number>;
  /** True when the two repairable gaps are present. */
  needsBackfill: boolean;
};

export type BoardBackfillApplyResult = {
  createdBoards: number;
  assignedPosts: number;
};

/** Refuse to run the repair while an unfixable association exists. */
export class BoardBackfillConflictError extends Error {
  constructor(count: number) {
    super(
      `${count} feedback post(s) reference a board from another product. ` +
        `Resolve those rows before running the repair.`,
    );
    this.name = "BoardBackfillConflictError";
  }
}

function toCount(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function inspectBoardBackfill(client: Client): Promise<BoardBackfillReport> {
  const counts = await client.query<{
    products: string;
    boards: string;
    posts: string;
    products_without_boards: string;
    products_without_default_board: string;
    posts_without_board: string;
    cross_product_posts: string;
  }>(`
    SELECT
      (SELECT count(*) FROM products)::text AS products,
      (SELECT count(*) FROM boards)::text AS boards,
      (SELECT count(*) FROM feedback_posts)::text AS posts,
      (SELECT count(*) FROM products p
        WHERE NOT EXISTS (SELECT 1 FROM boards b WHERE b.product_id = p.id))::text
        AS products_without_boards,
      (SELECT count(*) FROM products p
        WHERE NOT EXISTS (
          SELECT 1 FROM boards b WHERE b.product_id = p.id AND b.slug = 'feedback'
        ))::text AS products_without_default_board,
      (SELECT count(*) FROM feedback_posts WHERE board_id IS NULL)::text
        AS posts_without_board,
      (SELECT count(*) FROM feedback_posts fp
        INNER JOIN boards b ON b.id = fp.board_id
        WHERE b.product_id <> fp.product_id)::text AS cross_product_posts
  `);

  const row = counts.rows[0];
  const statuses = await client.query<{ status: string; count: string }>(`
    SELECT status::text AS status, count(*)::text AS count
    FROM feedback_posts
    GROUP BY 1
    ORDER BY 1
  `);

  const statusCounts: Record<string, number> = {};
  for (const status of statuses.rows) {
    statusCounts[status.status] = toCount(status.count);
  }

  const productsWithoutDefaultBoard = toCount(row?.products_without_default_board);
  const postsWithoutBoard = toCount(row?.posts_without_board);

  return {
    products: toCount(row?.products),
    boards: toCount(row?.boards),
    posts: toCount(row?.posts),
    productsWithoutBoards: toCount(row?.products_without_boards),
    productsWithoutDefaultBoard,
    postsWithoutBoard,
    crossProductPosts: toCount(row?.cross_product_posts),
    statusCounts,
    needsBackfill: productsWithoutDefaultBoard > 0 || postsWithoutBoard > 0,
  };
}

/**
 * Create missing default boards and assign unassigned posts.
 *
 * Idempotent: a second call on a reconciled database creates and assigns
 * nothing. The caller owns the transaction, so a failed re-check can roll the
 * whole repair back.
 */
export async function applyBoardBackfill(
  client: Client,
): Promise<BoardBackfillApplyResult> {
  const before = await inspectBoardBackfill(client);
  if (before.crossProductPosts > 0) {
    throw new BoardBackfillConflictError(before.crossProductPosts);
  }

  const created = await client.query(`
    INSERT INTO boards (product_id, name, slug, visibility, position)
    SELECT p.id, 'Feedback', 'feedback', 'public', 0
    FROM products p
    WHERE NOT EXISTS (
      SELECT 1 FROM boards b WHERE b.product_id = p.id AND b.slug = 'feedback'
    )
    RETURNING id
  `);

  const assigned = await client.query(`
    UPDATE feedback_posts fp
    SET board_id = b.id
    FROM boards b
    WHERE b.product_id = fp.product_id
      AND b.slug = 'feedback'
      AND fp.board_id IS NULL
    RETURNING fp.id
  `);

  return {
    createdBoards: created.rowCount ?? 0,
    assignedPosts: assigned.rowCount ?? 0,
  };
}

function printReport(report: BoardBackfillReport, mode: string): void {
  const statuses = Object.entries(report.statusCounts).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  console.log(`Board backfill reconciliation (${mode})`);
  console.log(`  products: ${report.products}`);
  console.log(`  boards: ${report.boards}`);
  console.log(`  feedback posts: ${report.posts}`);
  console.log(`  products with no board: ${report.productsWithoutBoards}`);
  console.log(
    `  products missing the default "feedback" board: ${report.productsWithoutDefaultBoard}`,
  );
  console.log(`  feedback posts without a board: ${report.postsWithoutBoard}`);
  console.log(
    `  feedback posts on a board from another product: ${report.crossProductPosts}`,
  );
  console.log(
    `  statuses: ${
      statuses.length === 0
        ? "(none)"
        : statuses.map(([status, count]) => `${status}=${count}`).join(", ")
    }`,
  );
  console.log(
    `  result: ${
      report.needsBackfill || report.crossProductPosts > 0
        ? "drift detected"
        : "consistent"
    }`,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== "--apply");
  if (unknown.length > 0) {
    console.error(`Unknown argument(s): ${unknown.join(", ")}. Use --apply to repair.`);
    process.exitCode = 2;
    return;
  }

  const apply = args.includes("--apply");
  const client = new Client({
    connectionString: getDatabaseUrl(),
    application_name: "herald-reconcile-boards",
  });

  await client.connect();
  try {
    const before = await inspectBoardBackfill(client);
    printReport(before, apply ? "before repair" : "dry run");

    if (!apply) {
      if (before.needsBackfill) {
        console.error(
          "Drift detected. Re-run with --apply to create missing default boards and assign posts.",
        );
        process.exitCode = 1;
      } else if (before.crossProductPosts > 0) {
        console.error(
          "Cross-product board references exist and need a manual fix; nothing can be repaired automatically.",
        );
        process.exitCode = 1;
      }
      return;
    }

    if (!before.needsBackfill && before.crossProductPosts === 0) {
      console.log("Nothing to repair.");
      return;
    }

    await client.query("BEGIN");
    try {
      const result = await applyBoardBackfill(client);
      const after = await inspectBoardBackfill(client);

      if (after.needsBackfill || after.crossProductPosts > 0) {
        await client.query("ROLLBACK");
        console.error("Repair did not reconcile the data; rolled back.");
        process.exitCode = 1;
        return;
      }

      await client.query("COMMIT");
      console.log(`Created default boards: ${result.createdBoards}`);
      console.log(`Assigned feedback posts: ${result.assignedPosts}`);
      printReport(after, "after repair");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  } finally {
    await client.end().catch(() => {});
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
