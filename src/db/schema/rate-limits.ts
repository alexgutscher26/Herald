import { index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

const tz = { withTimezone: true } as const;

/**
 * Durable fixed-window rate-limit counters.
 *
 * A table rather than an in-process map: public endpoints run on multiple
 * instances and serverless invocations, where a per-process counter would let
 * a caller multiply its allowance by opening more connections.
 *
 * `bucket` is an opaque, hashed key (never a raw IP address). Rows for old
 * windows can be pruned by maintenance; they carry no user data.
 */
export const rateLimitCounters = pgTable(
  "rate_limit_counters",
  {
    bucket: text("bucket").notNull(),
    windowStart: timestamp("window_start", tz).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [
    primaryKey({ name: "rate_limit_counters_pk", columns: [t.bucket, t.windowStart] }),
    index("rate_limit_counters_window_idx").on(t.windowStart),
  ],
);

export type RateLimitCounter = typeof rateLimitCounters.$inferSelect;
