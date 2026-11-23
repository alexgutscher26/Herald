/**
 * Disposable-database integration harness.
 *
 * The unit suite never opens a socket. This harness is the other half: it
 * provisions a throwaway database on a real Postgres server, applies the
 * committed Drizzle migrations, points the application at it, and isolates
 * every test in a transaction that is always rolled back.
 *
 * Properties worth keeping:
 *  - The database is named `herald_test_*` and is dropped after the suite.
 *    Nothing is written to the database named in `TEST_DATABASE_URL`.
 *  - Migrations come from `drizzle/meta/_journal.json` and the `.sql` files in
 *    `drizzle/`, so the tests prove what production will actually apply.
 *  - Each test runs through the application's own `db` handle on a single
 *    connection, so queries inside the test (including the app's nested
 *    transactions) see the fixture data and disappear on rollback.
 */

import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { test } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";

import { attachDatabaseHandle, type Database } from "@/db";
import { recordQuery } from "@/db/query-count";
import { resetServerEnvCache } from "@/lib/env";
import * as schema from "@/db/schema";
import { clearPublicPayloadCache } from "@/features/public/payload-cache";

// Integration tests exercise the real adapters. A developer `.env` with
// SANDBOX_MODE=on must not silently turn deliveries into skips; the tests that
// assert sandbox behaviour set the flag themselves.
delete process.env.SANDBOX_MODE;

const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");
const JOURNAL_PATH = path.join(MIGRATIONS_DIR, "meta", "_journal.json");

/** Hooks and tests talk to a remote database; the default 5s is too tight. */
export const SETUP_TIMEOUT_MS = 90_000;
const TEST_TIMEOUT_MS = 20_000;

type JournalEntry = {
  idx: number;
  when: number;
  tag: string;
};

type State = {
  databaseName: string;
  connectionString: string;
  admin: Client;
  app: Client;
  handle: Database;
  migrationTags: string[];
};

type MigrationRun = {
  applied: string[];
  total: number;
};

let state: State | null = null;

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: string }).code;
    return error.message || code || error.name;
  }
  return String(error);
}

/**
 * Server to provision the disposable database on.
 *
 * `TEST_DATABASE_URL` is an explicit opt-in and is never used directly: the
 * named database only provides credentials and a host. Without it, a fallback
 * to `DATABASE_URL` is allowed only for loopback servers, so a developer's
 * remote database is never touched by accident.
 */
function resolveServerUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL?.trim();
  if (explicit) return explicit;

  const fallback = process.env.DATABASE_URL?.trim();
  if (!fallback) {
    throw new Error(
      "Integration tests need a Postgres server. Set TEST_DATABASE_URL to a " +
        "disposable database whose role can CREATE DATABASE (see README.md).",
    );
  }

  const host = new URL(fallback).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    throw new Error(
      "Refusing to provision a test database from DATABASE_URL because it is " +
        "not a loopback host. Set TEST_DATABASE_URL explicitly to opt in.",
    );
  }

  return fallback;
}

function withDatabase(connectionString: string, database: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

/** `CREATE DATABASE` cannot run inside a transaction, so it needs its own client. */
async function connectAdmin(connectionString: string): Promise<Client> {
  const own =
    decodeURIComponent(new URL(connectionString).pathname.replace(/^\//, "")) || "postgres";
  const candidates = [...new Set(["postgres", "template1", own])];

  let lastError: unknown = null;
  for (const candidate of candidates) {
    const client = new Client({
      connectionString: withDatabase(connectionString, candidate),
      application_name: "herald-test-admin",
    });
    try {
      await client.connect();
      return client;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => {});
    }
  }

  throw new Error(
    `Could not reach a Postgres administration database. ${describeError(lastError)}`,
  );
}

function newDatabaseName(): string {
  const suffix = randomBytes(4).toString("hex");
  return `herald_test_${process.pid.toString(36)}_${suffix}`;
}

/**
 * Apply every journal entry that is not applied yet.
 *
 * Mirrors the production workflow: statements are split on Drizzle's
 * breakpoint marker, each migration runs in its own transaction, and a
 * `drizzle_migrations` row records the file hash and journal timestamp.
 */
async function applyMigrations(client: Client): Promise<MigrationRun> {
  const journal = JSON.parse(await readFile(JOURNAL_PATH, "utf8")) as {
    entries: JournalEntry[];
  };
  const entries = [...journal.entries].sort((left, right) => left.idx - right.idx);
  if (entries.length === 0) {
    throw new Error("No migrations were found in drizzle/meta/_journal.json.");
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS "public"."drizzle_migrations" (
      "id" serial PRIMARY KEY,
      "hash" text NOT NULL,
      "created_at" bigint
    )
  `);

  const existing = await client.query<{ hash: string }>(
    `SELECT "hash" FROM "public"."drizzle_migrations" ORDER BY "id" ASC`,
  );
  const appliedHashes = new Set(existing.rows.map((row) => row.hash));
  const applied: string[] = [];

  for (const entry of entries) {
    const sqlText = await readFile(path.join(MIGRATIONS_DIR, `${entry.tag}.sql`), "utf8");
    const hash = createHash("sha256").update(sqlText).digest("hex");
    if (appliedHashes.has(hash)) continue;

    await client.query("BEGIN");
    try {
      for (const statement of sqlText.split("--> statement-breakpoint")) {
        const trimmed = statement.trim();
        if (trimmed.length > 0) await client.query(trimmed);
      }
      await client.query(
        `INSERT INTO "public"."drizzle_migrations" ("hash", "created_at") VALUES ($1, $2)`,
        [hash, entry.when],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw new Error(`Migration ${entry.tag} failed: ${describeError(error)}`);
    }

    appliedHashes.add(hash);
    applied.push(entry.tag);
  }

  const counted = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM "public"."drizzle_migrations"`,
  );
  if (Number(counted.rows[0]?.count ?? 0) !== entries.length) {
    throw new Error(
      "The drizzle_migrations table does not match the journal after applying it.",
    );
  }

  return { applied, total: entries.length };
}

async function dropDatabase(admin: Client, databaseName: string): Promise<void> {
  await admin
    .query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [databaseName],
    )
    .catch(() => {});
  await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
}

/**
 * Create and migrate the disposable database, then install its handle.
 *
 * Call from `beforeAll` with `SETUP_TIMEOUT_MS`; always pair it with
 * `teardownTestDatabase()` in `afterAll`.
 */
export async function setupTestDatabase(): Promise<void> {
  if (state) return;

  // The previous file may have changed BETTER_AUTH_URL or the database URL.
  // Parse after those values are in place, not from the first file's cache.
  resetServerEnvCache();
  const serverUrl = resolveServerUrl();
  const databaseName = newDatabaseName();
  const admin = await connectAdmin(serverUrl);

  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
  } catch (error) {
    await admin.end().catch(() => {});
    throw new Error(
      `Could not create ${databaseName}; the role in TEST_DATABASE_URL needs ` +
        `CREATEDB. ${describeError(error)}`,
    );
  }

  const connectionString = withDatabase(serverUrl, databaseName);
  const migrationClient = new Client({
    connectionString,
    application_name: "herald-test-migrate",
  });

  try {
    await migrationClient.connect();
    const run = await applyMigrations(migrationClient);
    await migrationClient.end();

    const app = new Client({
      connectionString,
      application_name: "herald-test-app",
    });
    await app.connect();

    const handle = drizzle(app, {
      schema,
      logger: { logQuery: (query) => recordQuery(query) },
    });
    attachDatabaseHandle(handle);

    state = {
      databaseName,
      connectionString,
      admin,
      app,
      handle,
      migrationTags: run.applied,
    };
  } catch (error) {
    await migrationClient.end().catch(() => {});
    await dropDatabase(admin, databaseName).catch(() => {});
    await admin.end().catch(() => {});
    throw error;
  }
}

/** Close the app connection and drop the database. Safe to call twice. */
export async function teardownTestDatabase(): Promise<void> {
  const current = state;
  if (!current) return;
  state = null;

  await current.app.end().catch(() => {});
  attachDatabaseHandle(null);

  try {
    await dropDatabase(current.admin, current.databaseName);
  } finally {
    await current.admin.end().catch(() => {});
  }
}

/** The raw connection behind the application handle. Test-only. */
export function testDatabaseClient(): Client {
  if (!state) throw new Error("setupTestDatabase() has not run.");
  return state.app;
}

export function testDatabaseInfo(): { name: string; migrationTags: string[] } {
  if (!state) throw new Error("setupTestDatabase() has not run.");
  return { name: state.databaseName, migrationTags: [...state.migrationTags] };
}

/** Connection string for the disposable database (auxiliary clients). */
export function testDatabaseConnectionString(): string {
  if (!state) throw new Error("setupTestDatabase() has not run.");
  return state.connectionString;
}

/** The single-connection handle the harness installed, for restoring it. */
export function testDatabaseHandle(): Database {
  if (!state) throw new Error("setupTestDatabase() has not run.");
  return state.handle;
}

/**
 * Re-run the migration runner against the same database.
 *
 * Used to prove idempotence: a second pass must apply nothing.
 */
export async function applyMigrationsAgain(): Promise<number> {
  const current = state;
  if (!current) throw new Error("setupTestDatabase() has not run.");

  const client = new Client({
    connectionString: current.connectionString,
    application_name: "herald-test-remigrate",
  });
  await client.connect();
  try {
    const run = await applyMigrations(client);
    return run.applied.length;
  } finally {
    await client.end().catch(() => {});
  }
}

type RollbackOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

const ROLLBACK = Symbol("herald.test.rollback");

/**
 * Run `fn` inside a transaction, then roll the transaction back.
 *
 * The application's handle is swapped for the transaction for the duration of
 * the callback. App code that opens its own transaction therefore creates a
 * savepoint on the same connection instead of committing the outer one.
 */
export async function inRollback<T>(fn: () => Promise<T>): Promise<T> {
  const current = state;
  if (!current) throw new Error("Call setupTestDatabase() before inRollback().");

  // Public payload caching is process-wide; a test must never observe a row
  // cached by an earlier test.
  clearPublicPayloadCache();

  const outcomes: RollbackOutcome<T>[] = [];

  try {
    await current.handle.transaction(async (transaction) => {
      attachDatabaseHandle(transaction as unknown as Database);
      try {
        outcomes.push({ ok: true, value: await fn() });
      } catch (error) {
        outcomes.push({ ok: false, error });
      } finally {
        attachDatabaseHandle(current.handle);
      }
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }

  clearPublicPayloadCache();

  const outcome = outcomes[0];
  if (!outcome) throw new Error("The test transaction produced no result.");
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

/** Register a test whose writes are always rolled back. */
export function isolatedTest(
  name: string,
  fn: () => Promise<void>,
  timeoutMs = TEST_TIMEOUT_MS,
): void {
  test(
    name,
    async () => {
      await inRollback(fn);
    },
    timeoutMs,
  );
}
