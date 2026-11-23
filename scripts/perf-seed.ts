/**
 * Seed a disposable database with realistic rows for plan and load testing.
 * Never run this against production: it creates a clearly prefixed workspace
 * plus every table the measured surfaces read.
 *
 *   DATABASE_URL=postgresql://… bun scripts/perf-seed.ts 10000
 *
 * The printed JSON is the input for `scripts/perf-surfaces.ts` and the load
 * tests in CI: it carries the public path, the newest request id and a bearer
 * token for `/api/v1` (the token is invented here, never a real credential).
 */
import { randomUUID } from "node:crypto";
import { Client } from "pg";

import { createApiTokenMaterial } from "@/features/api-v1/token";

import { assertScriptEnvironment } from "./lib/guard";

assertScriptEnvironment("perf-seed");

const defaults = {
  posts: 10_000,
  customers: 500,
  conversations: 2_000,
  analyticsDays: 30,
  analyticsEventsPerDay: 100,
};

const posts = Math.min(
  Math.max(Number(process.argv[2] ?? defaults.posts) || defaults.posts, 1),
  100_000,
);
const connectionString = process.env.DATABASE_URL as string;

const client = new Client({ connectionString });
await client.connect();

try {
  const suffix = randomUUID().slice(0, 8);
  const slug = `perf-${suffix}`;
  const workspaceId = randomUUID();
  const productId = randomUUID();
  const boardId = randomUUID();
  const userId = `perf-user-${suffix}`;
  const userEmail = `${userId}@perf.test`;
  const apiToken = createApiTokenMaterial();

  await client.query(
    `INSERT INTO "user" (id, name, email, email_verified)
     VALUES ($1, $2, $3, true)`,
    [userId, "Performance operator", userEmail],
  );
  await client.query(
    `INSERT INTO workspaces (id, name, slug, plan, created_by)
     VALUES ($1, $2, $3, 'pro', $4)`,
    [workspaceId, "Performance workspace", slug, userId],
  );
  await client.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, 'owner')`,
    [workspaceId, userId],
  );
  await client.query(
    `INSERT INTO products
       (id, workspace_id, name, slug, public_feedback_enabled, public_roadmap_enabled, public_changelog_enabled)
     VALUES ($1, $2, $3, $4, true, true, true)`,
    [productId, workspaceId, "Performance product", "feedback"],
  );
  await client.query(
    `INSERT INTO boards (id, product_id, name, slug, visibility, guest_posting)
     VALUES ($1, $2, $3, $4, 'public', true)`,
    [boardId, productId, "Performance board", "feedback"],
  );
  await client.query(
    `INSERT INTO api_tokens (workspace_id, name, token_hash, prefix, scopes, created_by)
     VALUES ($1, 'performance probe', $2, $3, '["read"]'::jsonb, $4)`,
    [workspaceId, apiToken.tokenHash, apiToken.prefix, userId],
  );

  // Customers are the requesters and voters the public page joins against.
  const customers = Math.min(defaults.customers, posts);
  await client.query(
    `INSERT INTO customers (workspace_id, name, email, email_normalized, traits, verified_at)
     SELECT $1, 'Customer ' || n, 'customer' || n || '@perf.test',
            'customer' || n || '@perf.test',
            jsonb_build_object('plan', (ARRAY['free','starter','pro'])[1 + (n % 3)]),
            now() - (n || ' days')::interval
     FROM generate_series(1, $2::int) AS n`,
    [workspaceId, customers],
  );

  await client.query(
    `INSERT INTO feedback_posts
       (product_id, board_id, title, body, status, category, author_label,
        author_customer_id, created_at, updated_at)
     SELECT $1, $2,
       'Request ' || n || ' — ' || (ARRAY['Improve checkout','Slack alerts','Faster exports','Better search','Mobile layout'])[1 + (n % 5)],
       'This is a realistic request body for performance testing. It mentions checkout, exports, search and a weekly workflow. Row ' || n || '.',
       (ARRAY['open','under_review','planned','in_progress','shipped','closed'])[1 + (n % 6)]::feedback_status,
       (ARRAY['feature_request','bug','improvement','question'])[1 + (n % 4)]::feedback_category,
       'Customer ' || n,
       c.id,
       now() - (n || ' minutes')::interval,
       now() - (n || ' minutes')::interval
     FROM generate_series(1, $3::int) AS n
     JOIN customers c
       ON c.workspace_id = $4
      AND c.email_normalized = 'customer' || (1 + (n % $5::int)) || '@perf.test'`,
    [productId, boardId, posts, workspaceId, customers],
  );

  const requestRows = await client.query<{ id: string }>(
    `SELECT id FROM feedback_posts
     WHERE product_id = $1 AND hidden_at IS NULL AND archived_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [productId],
  );
  const requestId = requestRows.rows[0]?.id;
  if (!requestId) throw new Error("The seeded product has no visible request.");

  // One public comment per request, so the request detail page has comments and
  // the dashboard snapshot has a non-trivial comment set.
  await client.query(
    `INSERT INTO feedback_comments
       (product_id, feedback_post_id, author_customer_id, author_name, author_type, body, internal, created_at)
     SELECT p.product_id, p.id, p.author_customer_id, 'Customer',
            'customer', 'I would also use this every week.', false,
            p.created_at + interval '1 hour'
     FROM feedback_posts p
     WHERE p.product_id = $1 AND p.author_customer_id IS NOT NULL`,
    [productId],
  );

  // Two public votes per request, each from a different customer.
  for (const offset of [0, 1]) {
    await client.query(
      `WITH numbered AS (
         SELECT id, row_number() OVER (ORDER BY created_at) AS rn
         FROM feedback_posts WHERE product_id = $1
       )
       INSERT INTO feedback_customer_votes (feedback_post_id, customer_id, created_at)
       SELECT n.id, c.id, now() - (n.rn || ' minutes')::interval
       FROM numbered n
       JOIN customers c
         ON c.workspace_id = $2
        AND c.email_normalized = 'customer' || (1 + ((n.rn + $3::int) % $4::int)) || '@perf.test'
       ON CONFLICT DO NOTHING`,
      [productId, workspaceId, offset, customers],
    );
  }

  await client.query(
    `INSERT INTO conversations
       (workspace_id, product_id, customer_id, status, subject, last_message_preview,
        last_message_at, created_at, unread_for_team)
     SELECT $1, $2, c.id,
            (ARRAY['queue','open','resolved'])[1 + (n % 3)]::conversation_status,
            'Question ' || n || ' about ' || (ARRAY['billing','exports','Slack','login'])[1 + (n % 4)],
            'Latest reply about row ' || n,
            now() - (n || ' minutes')::interval,
            now() - (n || ' hours')::interval,
            n % 3
     FROM generate_series(1, $3::int) AS n
     JOIN customers c
       ON c.workspace_id = $1
      AND c.email_normalized = 'customer' || (1 + (n % $4::int)) || '@perf.test'`,
    [workspaceId, productId, defaults.conversations, customers],
  );

  await client.query(
    `INSERT INTO conversation_messages
       (conversation_id, product_id, author_type, author_customer_id, body, channel, created_at)
     SELECT cv.id, cv.product_id, 'customer', cv.customer_id,
            'Could you help with this?', 'widget', cv.created_at
     FROM conversations cv WHERE cv.product_id = $1`,
    [productId],
  );
  await client.query(
    `INSERT INTO conversation_messages
       (conversation_id, product_id, author_type, author_user_id, body, channel, created_at)
     SELECT cv.id, cv.product_id, 'team', $2,
            'Happy to help — here is what I found.', 'team',
            cv.created_at + interval '30 minutes'
     FROM conversations cv WHERE cv.product_id = $1`,
    [productId, userId],
  );

  // Raw events feed the portal card; the daily rollups below feed the overview.
  await client.query(
    `INSERT INTO analytics_events
       (workspace_id, product_id, board_id, type, visitor_hash, metadata, occurred_at)
     SELECT $1, $2, $3,
            (ARRAY['board_view','request_view','portal_page_view','vote','submission'])[1 + (n % 5)]::analytics_event_type,
            'visitor-' || (n % 200),
            CASE WHEN n % 5 = 2
              THEN jsonb_build_object('page', (ARRAY['roadmap','updates','help'])[1 + (n % 3)])
              ELSE NULL END,
            now() - ((n % $4::int) || ' days')::interval - ((n % 1440) || ' minutes')::interval
     FROM generate_series(1, $5::int) AS n`,
    [
      workspaceId,
      productId,
      boardId,
      defaults.analyticsDays,
      defaults.analyticsDays * defaults.analyticsEventsPerDay,
    ],
  );

  await client.query(
    `INSERT INTO analytics_daily (workspace_id, product_id, day, metric, value)
     SELECT $1, $2, (now() - (d || ' days')::interval)::date, m.metric,
            (100 + (d * 7) + (length(m.metric) * 3))::bigint
     FROM generate_series(0, $3::int - 1) AS d
     CROSS JOIN unnest(ARRAY[
       'board_views','request_views','submit_started','submissions','votes',
       'widget_opens','widget_installs','portal_page_views',
       'conversations_started','conversations_resolved','juno_resolved',
       'emails_sent','emails_failed','feedback_shipped',
       'time_to_ship_minutes','time_to_ship_count'
     ]) AS m(metric)
     ON CONFLICT DO NOTHING`,
    [workspaceId, productId, defaults.analyticsDays],
  );

  console.log(
    JSON.stringify(
      {
        workspaceSlug: slug,
        workspaceId,
        productSlug: "feedback",
        productId,
        boardSlug: "feedback",
        boardId,
        requestId,
        userEmail,
        apiToken: apiToken.token,
        publicPath: `/p/${slug}/feedback/feedback`,
        requestPath: `/p/${slug}/feedback/feedback/${requestId}`,
        counts: {
          posts,
          customers,
          comments: posts,
          customerVotes: posts * 2,
          conversations: defaults.conversations,
          messages: defaults.conversations * 2,
          analyticsEvents: defaults.analyticsDays * defaults.analyticsEventsPerDay,
          analyticsDays: defaults.analyticsDays,
        },
      },
      null,
      2,
    ),
  );
} finally {
  await client.end();
}
