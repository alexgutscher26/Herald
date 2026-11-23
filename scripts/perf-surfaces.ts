/**
 * Per-surface p95 and query-count probe for the targets in docs/performance.md.
 *
 * The public board is measured over HTTP by `scripts/perf-load.ts`. The other
 * surfaces sit behind a session or bearer token, so this probe measures their
 * real server data path — the same query functions the pages and the API call —
 * against a database seeded by `scripts/perf-seed.ts`.
 *
 *   DATABASE_URL=postgresql://… \
 *   bun --conditions=react-server scripts/perf-surfaces.ts
 *
 * Environment:
 *   PERF_REQUESTS     timed runs per surface (default 60)
 *   PERF_CONCURRENCY  parallel runs per surface (default 10)
 *   PERF_SURFACES     comma-separated name fragments (e.g. "inbox") to run a
 *                     subset; omitted runs every surface
 *
 * It fails when a p95 exceeds its target or when a data path issues more
 * statements than its budget (an N+1 guard: the count must not grow with rows).
 */
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

import { attachDatabaseHandle, type Database } from "@/db";
import { recordQuery, startQueryCount, stopQueryCount } from "@/db/query-count";
import * as schema from "@/db/schema";
import { listConversations } from "@/features/conversations/queries";
import { listRequests } from "@/features/api-v1/service";
import { parseRequestFilters } from "@/features/api-v1/filters";
import { loadDashboardSnapshot } from "@/features/live/snapshot";
import { getPublicRequestPage } from "@/features/public/queries";
import { getAnalyticsOverview } from "@/features/reporting/overview";
import { permissionsFor } from "@/lib/permissions";
import type { ProductContext } from "@/lib/authz";
import type { Product, Workspace } from "@/db/schema/workspaces";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const requests = Math.min(Math.max(Number(process.env.PERF_REQUESTS ?? 60) || 60, 1), 500);
const concurrency = Math.min(
  Math.max(Number(process.env.PERF_CONCURRENCY ?? 10) || 10, 1),
  requests,
);

const pool = new Pool({ connectionString, max: 10 });
const counted: Database = drizzle(pool, {
  schema,
  logger: { logQuery: (query) => recordQuery(query) },
});
attachDatabaseHandle(counted);

type Seed = {
  workspace: { id: string; slug: string; name: string; plan: string; createdAt: Date };
  product: {
    id: string;
    workspaceId: string;
    name: string;
    slug: string;
    description: string | null;
    publicFeedbackEnabled: boolean;
    publicRoadmapEnabled: boolean;
    publicChangelogEnabled: boolean;
    createdAt: Date;
  };
  board: { id: string; slug: string };
  user: { id: string; name: string; email: string };
  requestId: string;
};

async function loadSeed(): Promise<Seed> {
  const context = await pool.query(
    `SELECT p.id AS product_id, p.name AS product_name, p.slug AS product_slug,
            p.workspace_id, p.description, p.public_feedback_enabled,
            p.public_roadmap_enabled, p.public_changelog_enabled, p.created_at AS product_created_at,
            b.id AS board_id, b.slug AS board_slug,
            w.id AS workspace_id, w.name AS workspace_name, w.slug AS workspace_slug,
            w.created_at AS workspace_created_at,
            u.id AS user_id, u.name AS user_name, u.email AS user_email
       FROM products p
       JOIN boards b ON b.product_id = p.id
       JOIN workspaces w ON w.id = p.workspace_id
       LEFT JOIN workspace_members m ON m.workspace_id = w.id
       LEFT JOIN "user" u ON u.id = m.user_id
      ORDER BY p.created_at ASC, b.position ASC, m.created_at ASC
      LIMIT 1`,
  );
  const row = (context.rows as Record<string, unknown>[])[0];
  if (!row) throw new Error("No product found. Run scripts/perf-seed.ts first.");
  if (!row.user_id) throw new Error("The seeded workspace has no member user.");

  const newest = await pool.query(
    `SELECT id FROM feedback_posts
      WHERE product_id = $1 AND archived_at IS NULL AND hidden_at IS NULL AND merged_into_id IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [row.product_id as string],
  );
  const requestId = (newest.rows as { id: string }[])[0]?.id;
  if (!requestId) throw new Error("The seeded product has no visible request.");

  return {
    workspace: {
      id: row.workspace_id as string,
      name: row.workspace_name as string,
      slug: row.workspace_slug as string,
      plan: "pro",
      createdAt: row.workspace_created_at as Date,
    },
    product: {
      id: row.product_id as string,
      workspaceId: row.workspace_id as string,
      name: row.product_name as string,
      slug: row.product_slug as string,
      description: (row.description as string | null) ?? null,
      publicFeedbackEnabled: Boolean(row.public_feedback_enabled),
      publicRoadmapEnabled: Boolean(row.public_roadmap_enabled),
      publicChangelogEnabled: Boolean(row.public_changelog_enabled),
      createdAt: row.product_created_at as Date,
    },
    board: { id: row.board_id as string, slug: row.board_slug as string },
    user: {
      id: row.user_id as string,
      name: row.user_name as string,
      email: row.user_email as string,
    },
    requestId,
  };
}

const seed = await loadSeed();

const workspace: Workspace = {
  id: seed.workspace.id,
  name: seed.workspace.name,
  slug: seed.workspace.slug,
  plan: "pro",
  publicPlannedFor: false,
  doubleOptIn: false,
  outboundFrequencyCap: 0,
  outboundFrequencyWindowDays: 7,
  createdBy: seed.user.id,
  createdAt: seed.workspace.createdAt,
  updatedAt: seed.workspace.createdAt,
};
const product: Product = {
  id: seed.product.id,
  workspaceId: seed.product.workspaceId,
  name: seed.product.name,
  slug: seed.product.slug,
  description: seed.product.description ?? "",
  publicFeedbackEnabled: seed.product.publicFeedbackEnabled,
  publicRoadmapEnabled: seed.product.publicRoadmapEnabled,
  publicChangelogEnabled: seed.product.publicChangelogEnabled,
  publicShippedCounterEnabled: false,
  createdAt: seed.product.createdAt,
  updatedAt: seed.product.createdAt,
};
const context: ProductContext = {
  user: seed.user,
  workspace,
  role: "owner",
  permissions: permissionsFor("owner"),
  customRoleId: null,
  customRoleName: null,
  product,
};

const parsedFilters = parseRequestFilters(new URLSearchParams("limit=25"));
if (!parsedFilters.ok) throw new Error(parsedFilters.error);
const requestFilters = parsedFilters.value;

type Surface = {
  name: string;
  targetP95Ms: number;
  /** Statements one call may issue. Independent of row count by design. */
  queryBudget: number;
  run: () => Promise<unknown>;
};

const surfaces: Surface[] = [
  {
    name: "public request detail",
    targetP95Ms: 400,
    queryBudget: 20,
    run: () =>
      getPublicRequestPage({
        workspaceSlug: seed.workspace.slug,
        productSlug: seed.product.slug,
        boardSlug: seed.board.slug,
        requestId: seed.requestId,
      }),
  },
  {
    name: "dashboard feedback list",
    targetP95Ms: 450,
    queryBudget: 30,
    run: () => loadDashboardSnapshot(context),
  },
  {
    name: "dashboard inbox list",
    targetP95Ms: 450,
    queryBudget: 12,
    run: () =>
      listConversations({
        productId: seed.product.id,
        userId: seed.user.id,
        filters: { view: "queue", query: "", assignee: "any" },
        limit: 50,
      }),
  },
  {
    name: "analytics overview",
    targetP95Ms: 300,
    queryBudget: 10,
    run: () =>
      getAnalyticsOverview({
        workspaceId: seed.workspace.id,
        productId: seed.product.id,
        days: 30,
      }),
  },
  {
    name: "API list endpoint",
    targetP95Ms: 400,
    queryBudget: 15,
    run: () =>
      listRequests({
        workspaceId: seed.workspace.id,
        filters: requestFilters,
      }),
  },
];

async function measure(surface: Surface): Promise<{
  name: string;
  targetP95Ms: number;
  p50Ms: number;
  p95Ms: number;
  failures: number;
  queries: number;
  queryBudget: number;
  passed: boolean;
}> {
  // One warm run per surface, matching the documented "warm instance" target.
  await surface.run();

  const durations: number[] = [];
  let failures = 0;
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= requests) return;
      const started = performance.now();
      try {
        await surface.run();
      } catch (error) {
        failures += 1;
        console.error(`[perf] ${surface.name} failed:`, error);
      } finally {
        durations.push(performance.now() - started);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  durations.sort((left, right) => left - right);
  const percentile = (fraction: number) =>
    durations[Math.min(durations.length - 1, Math.floor(durations.length * fraction))] ?? 0;

  startQueryCount();
  await surface.run();
  const queries = stopQueryCount().length;

  const p95 = percentile(0.95);
  return {
    name: surface.name,
    targetP95Ms: surface.targetP95Ms,
    p50Ms: Math.round(percentile(0.5)),
    p95Ms: Math.round(p95),
    failures,
    queries,
    queryBudget: surface.queryBudget,
    passed:
      failures === 0 && p95 <= surface.targetP95Ms && queries <= surface.queryBudget,
  };
}

const selected = (process.env.PERF_SURFACES ?? "")
  .split(",")
  .map((name) => name.trim().toLowerCase())
  .filter(Boolean);
const chosen = selected.length
  ? surfaces.filter((surface) =>
      selected.some((name) => surface.name.toLowerCase().includes(name)),
    )
  : surfaces;
if (chosen.length === 0) {
  console.error(`PERF_SURFACES matched no surface: ${selected.join(", ")}`);
  process.exit(1);
}

const results = [];
for (const surface of chosen) results.push(await measure(surface));

console.log(
  JSON.stringify(
    {
      surface: "server data path",
      requests,
      concurrency,
      results,
    },
    null,
    2,
  ),
);

await pool.end();
attachDatabaseHandle(null);

if (results.some((result) => !result.passed)) process.exitCode = 1;
