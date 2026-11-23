import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db";

/**
 * Raw analytics-event CSV with the same privacy redactions as the UI.
 *
 * The visitor hash is never selected. Metadata is arbitrary JSON supplied by
 * the public page, so known identifiers are dropped by key and anything that
 * still looks like an email address is masked. The export is bounded because
 * it is a debugging aid, not a data warehouse dump.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const LIMIT = 10_000;
const REDACTED_KEYS = new Set([
  "visitorHash",
  "visitor_hash",
  "ip",
  "ipAddress",
  "ip_address",
  "userAgent",
  "user_agent",
  "email",
  "customerEmail",
  "customer_email",
  "sessionId",
  "session_id",
  "token",
]);

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (typeof value === "string") {
    return value.replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      "[redacted email]",
    );
  }
  if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !REDACTED_KEYS.has(key))
        .map(([key, item]) => [key, sanitize(item, depth + 1)]),
    );
  }
  return value;
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export async function buildRawEventCsv(input: {
  productId: string;
  days?: number;
  now?: Date;
}): Promise<{ csv: string; from: string; to: string; count: number }> {
  const days = Math.min(Math.max(Math.trunc(input.days ?? 30), 1), 90);
  const now = input.now ?? new Date();
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  const start = new Date(end.getTime() - days * DAY_MS);
  const result = await db.execute(sql`
    SELECT e."occurred_at", e."type",
           b."name" AS board, p."title" AS request,
           e."metadata"
    FROM "analytics_events" e
    LEFT JOIN "boards" b ON b."id" = e."board_id"
    LEFT JOIN "feedback_posts" p ON p."id" = e."feedback_post_id"
    WHERE e."product_id" = ${input.productId}
      AND e."occurred_at" >= ${start}
      AND e."occurred_at" < ${end}
    ORDER BY e."occurred_at" DESC
    LIMIT ${LIMIT}
  `);
  const rows = result.rows as Array<{
    occurred_at: Date | string;
    type: string;
    board: string | null;
    request: string | null;
    metadata: unknown;
  }>;
  const lines = [
    ["time_utc", "event", "board", "request", "metadata"].join(","),
    ...rows.map((row) =>
      [
        cell(row.occurred_at),
        cell(row.type),
        cell(row.board),
        cell(row.request),
        cell(sanitize(row.metadata)),
      ].join(","),
    ),
  ];
  return {
    csv: `${lines.join("\n")}\n`,
    from: start.toISOString().slice(0, 10),
    to: new Date(end.getTime() - DAY_MS).toISOString().slice(0, 10),
    count: rows.length,
  };
}
