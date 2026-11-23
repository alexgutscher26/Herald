import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";

import { poolSettings } from "@/db/pool-settings";
import { recordQuery } from "@/db/query-count";
import { instrumentClientQueryTiming } from "@/db/query-timing";
import * as schema from "@/db/schema";
import { getDatabaseUrl } from "@/lib/env";

/**
 * Database access layer.
 *
 * ## Driver choice
 *
 * Neon Postgres is reached over **TCP with `pg` (node-postgres)**, using
 * Neon's pooled endpoint. The HTTP-only `neon()` driver was rejected on
 * purpose: it issues every statement as an independent HTTP request, so it
 * cannot run an interactive transaction. This application needs real
 * transactions (workspace creation + owner membership + first product must
 * commit atomically, and Better Auth's Drizzle adapter runs multi-statement
 * units of work), so the driver must hold a connection open across
 * BEGIN ... COMMIT.
 *
 * `pg.Pool` gives us that, plus bounded connection reuse. Point
 * `DATABASE_URL` at the `-pooler` host so connection counts stay within
 * Neon's limits; `BEGIN`/`COMMIT` work correctly through the pooler's
 * transaction pooling mode.
 *
 * ## Import safety
 *
 * Nothing here runs at import time. The pool is created on first use through
 * a lazy proxy, so importing this module during `next build` never reads
 * `DATABASE_URL` and never opens a socket. When configuration is genuinely
 * missing, `getDatabaseUrl()` throws a descriptive error at the moment the
 * database is actually used — not a silent fallback, and not a fake success.
 *
 * Note that the pool validates `DATABASE_URL` only: `bun run db:migrate` and
 * `bun run db:studio` must work without authentication configuration that they
 * never use.
 */

export type Database = NodePgDatabase<typeof schema>;

let pool: Pool | null = null;
let database: Database | null = null;

function createDatabase(): Database {
  const connectionString = getDatabaseUrl();

  pool = new Pool({ connectionString, ...poolSettings() });

  // Time every statement on the client that will run it. This covers plain
  // queries and statements inside a transaction; see query-timing.ts.
  pool.on("connect", (client) => instrumentClientQueryTiming(client));

  // An idle client error must not take down the process.
  pool.on("error", (error) => {
    console.error("[db] idle client error:", error.message);
  });

  database = drizzle(pool, {
    schema,
    // Counting is inert until a perf probe or budget test starts a capture.
    logger: { logQuery: (query) => recordQuery(query) },
  });
  return database;
}

/** Eager accessor for code that prefers an explicit call over the proxy. */
export function getDb(): Database {
  return (database ??= createDatabase());
}

/** The underlying `pg` pool (migrations scripts, health checks). */
export function getPool(): Pool {
  getDb();
  if (!pool) throw new Error("Database pool was not initialised.");
  return pool;
}

/**
 * Lazily-proxied database handle.
 *
 * Property access transparently builds the pool on first use; importing the
 * module does not.
 */
export const db: Database = new Proxy({} as Database, {
  get(_target, property) {
    const real = getDb();
    const value = Reflect.get(real as object, property);
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(real)
      : value;
  },
  has(_target, property) {
    return Reflect.has(getDb() as object, property);
  },
  set(_target, property, value) {
    return Reflect.set(getDb() as object, property, value);
  },
  ownKeys() {
    return Reflect.ownKeys(getDb() as object);
  },
  getOwnPropertyDescriptor(_target, property) {
    return Object.getOwnPropertyDescriptor(getDb() as object, property);
  },
});

/**
 * Attach an externally owned database handle.
 *
 * The integration-test harness uses this to point the application at a
 * disposable database on a single connection, so one test can run inside one
 * transaction and always roll it back. Passing `null` detaches the handle.
 * Application code never calls this; `getDb()` owns the handle in production.
 */
export function attachDatabaseHandle(handle: Database | null): void {
  database = handle;
}

/** Close pooled connections. Used by scripts and tests, never by the app. */
export async function closeDb(): Promise<void> {
  if (!pool) return;
  const active = pool;
  pool = null;
  database = null;
  await active.end();
}