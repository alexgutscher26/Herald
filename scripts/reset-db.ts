/**
 * Reset database script.
 *
 * Drops and recreates the public schema, then applies all Drizzle migrations
 * from scratch to return the database to a clean, fresh state.
 *
 * Usage:
 *   bun run db:reset --yes
 *   bun run db:reset --yes --seed    # resets and then seeds demo data
 *
 * Refuses NODE_ENV=production, a non-loopback DATABASE_URL without
 * --allow-remote, and a run without --yes.
 */
import { execSync } from "node:child_process";
import { Client } from "pg";

import { assertScriptEnvironment } from "./lib/guard";

assertScriptEnvironment("reset-db", { requireYes: true });

const connectionString = process.env.DATABASE_URL as string;
const args = process.argv.slice(2);
const shouldSeed = args.includes("--seed");

console.log("Connecting to database...");
const client = new Client({ connectionString });
await client.connect();

try {
  console.log("Dropping and recreating public schema...");
  await client.query("DROP SCHEMA IF EXISTS public CASCADE");
  await client.query("CREATE SCHEMA public");
  await client.query("GRANT ALL ON SCHEMA public TO CURRENT_USER");
  await client.query("GRANT ALL ON SCHEMA public TO public");
  console.log("Schema public recreated successfully.");
} catch (error) {
  console.error("Failed to reset schema:", error instanceof Error ? error.message : error);
  process.exit(1);
} finally {
  await client.end();
}

console.log("Applying all migrations from scratch...");
try {
  execSync("bun run db:migrate", { stdio: "inherit" });
  console.log("Migrations applied successfully!");
} catch (error) {
  console.error("Failed to run migrations:", error instanceof Error ? error.message : error);
  process.exit(1);
}

if (shouldSeed) {
  console.log("Seeding demo data...");
  try {
    execSync("bun run db:seed", { stdio: "inherit" });
    console.log("Demo data seeded successfully!");
  } catch (error) {
    console.error("Failed to seed demo data:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

console.log("Database reset complete!");

