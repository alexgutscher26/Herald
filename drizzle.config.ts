import { defineConfig } from "drizzle-kit";

import { normalizeSslMode } from "./src/db/connection-string";

/**
 * Drizzle Kit configuration.
 *
 * `db:migrate` and `db:studio` read `DATABASE_URL` from the environment
 * (Bun loads `.env` for `bun run` scripts). `db:generate` only needs the
 * schema files, so it works without any database configured — the empty
 * fallback below is never used to connect, because generate does not open a
 * connection. Run migrate/studio with `DATABASE_URL` set.
 *
 * The connection string goes through the same `sslmode` normalisation the app
 * uses, so the CLI does not print the driver's upgrade warning either.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  migrations: {
    table: "drizzle_migrations",
    schema: "public",
  },
  strict: true,
  verbose: true,
  dbCredentials: {
    url: normalizeSslMode(process.env.DATABASE_URL ?? ""),
  },
});