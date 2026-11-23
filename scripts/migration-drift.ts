/**
 * Migration drift check.
 *
 * Two disposable databases are built independently:
 *
 *   1. `head`: every migration in today's `drizzle/_journal.json`, from zero.
 *   2. `upgrade`: the migrations of the previous release tag, then every
 *      migration added since — the path a deployed database actually takes.
 *
 * Their `information_schema` fingerprints must be identical. A difference
 * means the upgrade path and a fresh install disagree, which is the class of
 * bug that only shows up in production after a release.
 *
 * The previous release is resolved from git, so this script needs a checkout
 * with tags (fetch-depth: 0 in CI). Locally without a tag it exits 2 and the
 * test wrapper skips; `MIGRATION_REQUIRE_BASELINE=1` turns that into a failure.
 */
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { Client } from "pg";

type JournalEntry = { idx: number; when: number; tag: string };

const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");
const JOURNAL_PATH = path.join(MIGRATIONS_DIR, "meta", "_journal.json");

function serverUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!explicit) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
  const url = new URL(explicit);
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) {
    throw new Error("The migration drift check only runs against a loopback Postgres server.");
  }
  return explicit;
}

function withDatabase(connectionString: string, database: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

const baselineDirectory = process.env.MIGRATION_BASELINE_DIR?.trim() ?? "";

function previousTag(): string | null {
  const explicit = process.env.MIGRATION_BASELINE_TAG?.trim();
  if (explicit) return explicit;
  // A snapshot of `drizzle/` lets the upgrade path be exercised without a git
  // checkout (a shallow clone, a tarball, or a local verification run).
  if (baselineDirectory) return "local-directory-baseline";
  try {
    const tag = git(["describe", "--tags", "--abbrev=0", "HEAD"]).trim();
    return tag || null;
  } catch {
    return null;
  }
}

async function connectAdmin(connectionString: string): Promise<Client> {
  const own =
    decodeURIComponent(new URL(connectionString).pathname.replace(/^\//, "")) || "postgres";
  let lastError: unknown = null;
  for (const candidate of [...new Set(["postgres", "template1", own])]) {
    const client = new Client({
      connectionString: withDatabase(connectionString, candidate),
      application_name: "herald-migration-drift-admin",
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
    `Could not reach a Postgres administration database. ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

async function applyEntries(
  client: Client,
  entries: { tag: string; sql: string }[],
  label: string,
): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "public"."drizzle_migrations" (
      "id" serial PRIMARY KEY,
      "hash" text NOT NULL,
      "created_at" bigint
    )
  `);

  for (const entry of entries) {
    await client.query("BEGIN");
    try {
      for (const statement of entry.sql.split("--> statement-breakpoint")) {
        const trimmed = statement.trim();
        if (trimmed.length > 0) await client.query(trimmed);
      }
      await client.query(
        `INSERT INTO "public"."drizzle_migrations" ("hash", "created_at") VALUES ($1, $2)`,
        [entry.tag, Date.now()],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw new Error(
        `${label}: migration ${entry.tag} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

async function headEntries(): Promise<{ tag: string; sql: string }[]> {
  const journal = JSON.parse(await readFile(JOURNAL_PATH, "utf8")) as {
    entries: JournalEntry[];
  };
  return Promise.all(
    [...journal.entries]
      .sort((left, right) => left.idx - right.idx)
      .map(async (entry) => ({
        tag: entry.tag,
        sql: await readFile(path.join(MIGRATIONS_DIR, `${entry.tag}.sql`), "utf8"),
      })),
  );
}

async function baselineEntries(tag: string): Promise<{ tag: string; sql: string }[]> {
  const directory = baselineDirectory || null;
  const journal = JSON.parse(
    directory
      ? await readFile(path.join(directory, "meta", "_journal.json"), "utf8")
      : git(["show", `${tag}:drizzle/meta/_journal.json`]),
  ) as { entries: JournalEntry[] };

  return Promise.all(
    [...journal.entries]
      .sort((left, right) => left.idx - right.idx)
      .map(async (entry) => ({
        tag: entry.tag,
        sql: directory
          ? await readFile(path.join(directory, `${entry.tag}.sql`), "utf8")
          : git(["show", `${tag}:drizzle/${entry.tag}.sql`]),
      })),
  );
}

type Fingerprint = {
  columns: unknown[];
  indexes: unknown[];
  constraints: unknown[];
  enums: unknown[];
};

async function fingerprint(client: Client): Promise<Fingerprint> {
  const columns = await client.query(`
    SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
     WHERE table_schema = 'public'
     ORDER BY table_name, column_name
  `);
  const indexes = await client.query(`
    SELECT tablename, indexname, indexdef
      FROM pg_indexes
     WHERE schemaname = 'public'
     ORDER BY tablename, indexname
  `);
  const constraints = await client.query(`
    SELECT conrelid::regclass::text AS table_name, conname, contype, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
     WHERE connamespace = 'public'::regnamespace
     ORDER BY 1, 2
  `);
  const enums = await client.query(`
    SELECT t.typname, e.enumlabel, e.enumsortorder
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
     ORDER BY t.typname, e.enumsortorder
  `);

  return {
    columns: columns.rows,
    indexes: indexes.rows,
    constraints: constraints.rows,
    enums: enums.rows,
  };
}

function differences(left: Fingerprint, right: Fingerprint): string[] {
  const out: string[] = [];
  for (const key of Object.keys(left) as (keyof Fingerprint)[]) {
    const a = new Set(left[key].map((row) => JSON.stringify(row)));
    const b = new Set(right[key].map((row) => JSON.stringify(row)));
    for (const row of a) if (!b.has(row)) out.push(`head only ${key}: ${row}`);
    for (const row of b) if (!a.has(row)) out.push(`upgrade only ${key}: ${row}`);
  }
  return out;
}

async function createDatabase(admin: Client, name: string): Promise<Client> {
  await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
  await admin.query(`CREATE DATABASE "${name}"`);
  const client = new Client({
    connectionString: withDatabase(serverUrl(), name),
    application_name: "herald-migration-drift",
  });
  await client.connect();
  return client;
}

async function dropDatabase(admin: Client, name: string): Promise<void> {
  await admin
    .query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [name],
    )
    .catch(() => {});
  await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
}

const tag = previousTag();
if (!tag) {
  console.error(
    "migration-drift: no previous release tag. Set MIGRATION_BASELINE_TAG or fetch tags.",
  );
  if (process.env.MIGRATION_REQUIRE_BASELINE === "1") process.exit(1);
  process.exit(2);
}

const suffix = `${process.pid.toString(36)}_${Date.now().toString(36)}`;
const headName = `herald_drift_head_${suffix}`;
const upgradeName = `herald_drift_upgrade_${suffix}`;

const admin = await connectAdmin(serverUrl());
let head: Client | null = null;
let upgrade: Client | null = null;

try {
  const headMigrations = await headEntries();
  const baseMigrations = await baselineEntries(tag);
  const baseTags = new Set(baseMigrations.map((entry) => entry.tag));
  const since = headMigrations.filter((entry) => !baseTags.has(entry.tag));

  head = await createDatabase(admin, headName);
  await applyEntries(head, headMigrations, "head");

  upgrade = await createDatabase(admin, upgradeName);
  await applyEntries(upgrade, baseMigrations, `baseline ${tag}`);
  await applyEntries(upgrade, since, `since ${tag}`);

  const headFingerprint = await fingerprint(head);
  const upgradeFingerprint = await fingerprint(upgrade);
  const drift = differences(headFingerprint, upgradeFingerprint);

  console.log(
    JSON.stringify(
      {
        baselineTag: tag,
        headMigrations: headMigrations.length,
        baselineMigrations: baseMigrations.length,
        appliedSinceBaseline: since.map((entry) => entry.tag),
        drift: drift.length,
        differences: drift.slice(0, 50),
      },
      null,
      2,
    ),
  );

  if (drift.length > 0) process.exitCode = 1;
} finally {
  if (head) await head.end().catch(() => {});
  if (upgrade) await upgrade.end().catch(() => {});
  await dropDatabase(admin, headName).catch(() => {});
  await dropDatabase(admin, upgradeName).catch(() => {});
  await admin.end().catch(() => {});
}
