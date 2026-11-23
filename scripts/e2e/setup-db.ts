/**
 * Provision the end-to-end database from zero.
 *
 * Playwright needs a database that is already migrated *and* seeded before
 * the server answers its readiness probe. This script owns the first half:
 * drop and recreate `herald_e2e`, then apply every journal entry from
 * `drizzle/` exactly like production does (statement breakpoints, one
 * transaction per migration, a `drizzle_migrations` row per file).
 *
 * The URL comes from `E2E_DATABASE_URL`; it must point at a loopback server.
 * Nothing here reads the application's `DATABASE_URL`, so a developer cannot
 * truncate their real database by running the e2e suite.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { Client } from "pg";

const DEFAULT_URL = "postgres://herald:herald@localhost:5432/herald_e2e";
const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");
const JOURNAL_PATH = path.join(MIGRATIONS_DIR, "meta", "_journal.json");

type JournalEntry = { idx: number; when: number; tag: string };

function serverUrl(): string {
  const raw = process.env.E2E_DATABASE_URL?.trim() || DEFAULT_URL;
  const url = new URL(raw);
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) {
    throw new Error("E2E_DATABASE_URL must point at a loopback Postgres server.");
  }
  return raw;
}

function databaseName(connectionString: string): string {
  const name = decodeURIComponent(new URL(connectionString).pathname.replace(/^\//, ""));
  if (!name.startsWith("herald_e2e")) {
    throw new Error(
      `Refusing to drop "${name}": the e2e database name must start with herald_e2e.`,
    );
  }
  return name;
}

function withDatabase(connectionString: string, database: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: string }).code;
    return error.message || code || error.name;
  }
  return String(error);
}

async function connectAdmin(connectionString: string): Promise<Client> {
  const own =
    decodeURIComponent(new URL(connectionString).pathname.replace(/^\//, "")) || "postgres";
  let lastError: unknown = null;
  for (const candidate of [...new Set(["postgres", "template1", own])]) {
    const client = new Client({
      connectionString: withDatabase(connectionString, candidate),
      application_name: "herald-e2e-admin",
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
    `Could not reach a Postgres administration database on ${new URL(connectionString).host}. ${describeError(lastError)}`,
  );
}

async function applyMigrations(client: Client): Promise<string[]> {
  const journal = JSON.parse(await readFile(JOURNAL_PATH, "utf8")) as {
    entries: JournalEntry[];
  };
  const entries = [...journal.entries].sort((left, right) => left.idx - right.idx);
  if (entries.length === 0) throw new Error("No migrations found.");

  await client.query(`
    CREATE TABLE IF NOT EXISTS "public"."drizzle_migrations" (
      "id" serial PRIMARY KEY,
      "hash" text NOT NULL,
      "created_at" bigint
    )
  `);

  const applied: string[] = [];
  for (const entry of entries) {
    const sqlText = await readFile(path.join(MIGRATIONS_DIR, `${entry.tag}.sql`), "utf8");
    const hash = createHash("sha256").update(sqlText).digest("hex");

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
      throw new Error(
        `Migration ${entry.tag} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    applied.push(entry.tag);
  }
  return applied;
}

const connectionString = serverUrl();
const name = databaseName(connectionString);
const admin = await connectAdmin(connectionString);

try {
  await admin
    .query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [name],
    )
    .catch(() => {});
  await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
  await admin.query(`CREATE DATABASE "${name}"`);
} finally {
  await admin.end().catch(() => {});
}

const client = new Client({
  connectionString,
  application_name: "herald-e2e-migrate",
});
await client.connect();
try {
  const applied = await applyMigrations(client);
  console.log(
    JSON.stringify({ database: name, migrations: applied.length, tags: applied }, null, 2),
  );
} finally {
  await client.end().catch(() => {});
}
