/**
 * Better Auth schema diff.
 *
 * Better Auth's Drizzle adapter resolves columns by the export name (`user`,
 * `session`, `account`, `verification`) and by camelCase property names, so a
 * package upgrade that adds or renames a field breaks sign-in silently unless
 * the schema file is updated with it. This script reads the installed package's
 * core schema with `getSchema()` and compares it with
 * `src/db/schema/auth.ts` — property by property and type by type.
 *
 * Usage: `bun run check:auth-schema` (exit 0 = no drift, exit 1 = drift).
 *
 * Plugin tables (SCIM, SSO) are not part of the core schema and are not covered
 * here; the four core models are the ones the adapter maps automatically.
 */

import { getTableColumns } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { getSchema } from "better-auth/db";

import { account, session, user, verification } from "@/db/schema/auth";

type ModelSchema = {
  fields: Record<string, { type: string; required?: boolean; unique?: boolean }>;
};

const tables: Record<string, PgTable> = { user, session, account, verification };
const expected = getSchema({}) as Record<string, ModelSchema>;
const problems: string[] = [];
let checkedFields = 0;

for (const [modelName, model] of Object.entries(expected)) {
  const table = tables[modelName];
  if (!table) {
    problems.push(`${modelName}: no table exported from src/db/schema/auth.ts`);
    continue;
  }

  const columns = getTableColumns(table) as Record<string, { dataType: string }>;
  for (const [fieldName, field] of Object.entries(model.fields)) {
    checkedFields += 1;

    const column = columns[fieldName];
    if (!column) {
      problems.push(
        `${modelName}.${fieldName}: missing Drizzle property (accepted field names are camelCase)`,
      );
      continue;
    }
    if (column.dataType !== field.type) {
      problems.push(
        `${modelName}.${fieldName}: expected ${field.type}, found ${column.dataType}`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error(
    `Better Auth schema drift — update src/db/schema/auth.ts, then ` +
      `\`bun run db:generate\`:\n${problems.map((line) => `  - ${line}`).join("\n")}`,
  );
  process.exit(1);
}

console.log(
  `Better Auth schema matches the installed package: ` +
    `${Object.keys(expected).length} core tables, ${checkedFields} fields, no drift.`,
);
