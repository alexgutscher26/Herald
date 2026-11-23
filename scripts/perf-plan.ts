/**
 * Print `EXPLAIN (ANALYZE, BUFFERS)` for every measured read path.
 *
 * Uses the first product/board in the database; seed first with
 * `scripts/perf-seed.ts`.
 *
 *   bun run perf:plan
 *   PERF_PLAN_CHECK=1 bun run perf:plan     # fail on an unexpected Seq Scan
 *
 * `docs/performance.md` requires a plan check for every query that gains a new
 * filter or sort. Add the new read here; in check mode the script fails when a
 * large table is read by a sequential scan unless the surface deliberately
 * matches the whole table (the dashboard snapshot, which loads one product's
 * complete feedback set, and the 30-row-per-day rollup read).
 *
 * A sequential scan is not automatically wrong: when the predicate matches the
 * whole table an index would add a heap fetch per row. The allowlist records
 * that decision per query, so a new unindexed filter cannot slip through it.
 */
import { Client } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const check = process.env.PERF_PLAN_CHECK === "1";

type Plan = {
  label: string;
  query: string;
  values: unknown[];
  /** Tables where a sequential scan is the intended plan for this predicate. */
  allowSequentialScan?: string[];
};

const client = new Client({ connectionString });
await client.connect();

try {
  const context = await client.query<{
    workspace_id: string;
    product_id: string;
    board_id: string;
    request_id: string;
  }>(
    `SELECT p.workspace_id, p.id AS product_id, b.id AS board_id,
            (SELECT id FROM feedback_posts
              WHERE product_id = p.id AND archived_at IS NULL
                AND hidden_at IS NULL AND merged_into_id IS NULL
              ORDER BY created_at DESC LIMIT 1) AS request_id
     FROM products p JOIN boards b ON b.product_id = p.id
     ORDER BY p.created_at ASC, b.position ASC LIMIT 1`,
  );
  const row = context.rows[0];
  if (!row || !row.request_id) {
    throw new Error("No product/board/request found. Run scripts/perf-seed.ts first.");
  }

  const plans: Plan[] = [
    {
      label: "public board page",
      query: `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
         SELECT id, title, status, created_at
         FROM feedback_posts
         WHERE board_id = $1 AND archived_at IS NULL AND hidden_at IS NULL AND merged_into_id IS NULL
         ORDER BY created_at DESC LIMIT 25`,
      values: [row.board_id],
    },
    {
      label: "public search",
      query: `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
         SELECT id, title, status, created_at
         FROM feedback_posts
         WHERE product_id = $1 AND title ILIKE '%checkout%'
           AND archived_at IS NULL AND hidden_at IS NULL AND merged_into_id IS NULL
         ORDER BY created_at DESC LIMIT 25`,
      values: [row.product_id],
    },
    {
      label: "inbox list",
      query: `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
         SELECT id, subject, status, last_message_at
         FROM conversations
         WHERE product_id = $1 AND status <> 'archived'
         ORDER BY last_message_at DESC LIMIT 25`,
      values: [row.product_id],
    },
    {
      label: "public request detail",
      query: `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
         SELECT id, title, body, status, category, created_at
         FROM feedback_posts
         WHERE id = $1 AND board_id = $2 AND product_id = $3
           AND archived_at IS NULL AND hidden_at IS NULL AND merged_into_id IS NULL
         LIMIT 1`,
      values: [row.request_id, row.board_id, row.product_id],
    },
    {
      label: "dashboard feedback list",
      query: `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
         SELECT p.id, p.title, p.status, p.created_at, u.name
         FROM feedback_posts p
         LEFT JOIN "user" u ON u.id = p.author_id
         LEFT JOIN customers c ON c.id = p.author_customer_id
         WHERE p.product_id = $1
         ORDER BY p.created_at DESC`,
      values: [row.product_id],
      // The snapshot loads one product's entire feedback set: selectivity 1.
      // The author join hashes a handful of workspace members, so scanning
      // "user" is cheaper than an index probe per row.
      allowSequentialScan: ["feedback_posts", "user"],
    },
    {
      label: "analytics overview (30 daily rollups)",
      query: `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
         SELECT day, metric, sum(value)
         FROM analytics_daily
         WHERE workspace_id = $1 AND product_id = $2
           AND day >= (current_date - 29)
         GROUP BY day, metric
         ORDER BY day`,
      values: [row.workspace_id, row.product_id],
      // 480 rows for 30 days and all metrics; an index would not help.
      allowSequentialScan: ["analytics_daily"],
    },
  ];

  const failures: string[] = [];

  for (const plan of plans) {
    console.log(`\n=== ${plan.label} ===`);
    const result = await client.query(plan.query, plan.values);
    const text = result.rows
      .map((line: Record<string, unknown>) => String(line["QUERY PLAN"] ?? line))
      .join("\n");
    console.log(text);

    if (!check) continue;

    const scanned = [...text.matchAll(/(?:Parallel )?Seq Scan on "?([a-z_]+)"?/g)]
      .map((match) => match[1])
      .filter((table): table is string => table !== undefined);
    const unexpected = scanned.filter(
      (table) => !(plan.allowSequentialScan ?? []).includes(table),
    );
    if (unexpected.length > 0) {
      failures.push(`${plan.label}: sequential scan on ${[...new Set(unexpected)].join(", ")}`);
    }
  }

  if (failures.length > 0) {
    console.error(
      `\nPlan check failed:\n${failures
        .map((failure) => ` - ${failure}`)
        .join("\n")}\nAdd the supporting index or record the deliberate full-table read in this script.`,
    );
    process.exitCode = 1;
  } else if (check) {
    console.log("\nPlan check passed: no unexpected sequential scans.");
  }
} finally {
  await client.end();
}
