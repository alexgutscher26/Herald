/**
 * Import Herald's own user documentation into the help center Herald runs.
 *
 * This is the dogfooding path, not a second importer: every article is parsed
 * by the same `parseMarkdownImport` the dashboard upload uses and written by
 * `importHelpItems`, so publishing to Herald's help center exercises the
 * product's real import, revision and Juno knowledge-sync code.
 *
 * Sources live in `docs/help/*.md` with flat front matter:
 *
 *   ---
 *   title: Install the widget
 *   slug: install-the-widget
 *   collection: Getting started
 *   ---
 *
 * `importHelpItems(..., { publish: true })` publishes every draft article in a
 * collection it touches. That is the same behaviour as the dashboard import;
 * keep hand-written drafts out of the collections used here.
 *
 * Usage: `bun run db:import-help`
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { and, asc, eq } from "drizzle-orm";

import { closeDb, db } from "@/db";
import { products, workspaceMembers, workspaces } from "@/db/schema";
import { parseMarkdownImport, type HelpImportItem } from "@/features/help/import-parse";
import { importHelpItems } from "@/features/help/service";

import { assertScriptEnvironment } from "./lib/guard";

assertScriptEnvironment("import-herald-help");

const WORKSPACE_SLUG = "herald";
const PRODUCT_SLUG = "herald";
const HELP_DIRECTORY = path.join(process.cwd(), "docs", "help");

async function main() {
  const directories = await readdir(HELP_DIRECTORY).catch(() => {
    throw new Error(`No help sources at ${HELP_DIRECTORY}.`);
  });
  const files = directories.filter((name) => name.endsWith(".md")).sort();
  if (files.length === 0) {
    throw new Error(`No Markdown articles in ${HELP_DIRECTORY}.`);
  }

  const workspaceRows = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.slug, WORKSPACE_SLUG))
    .limit(1);
  const workspace = workspaceRows[0];
  if (!workspace) {
    throw new Error(
      `No "${WORKSPACE_SLUG}" workspace. Run \`bun run db:seed-herald\` first, then sign in once so the import has an author.`,
    );
  }

  const productRows = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.workspaceId, workspace.id), eq(products.slug, PRODUCT_SLUG)))
    .limit(1);
  const product = productRows[0];
  if (!product) {
    throw new Error(
      `No "${PRODUCT_SLUG}" product in the "${WORKSPACE_SLUG}" workspace. Run \`bun run db:seed-herald\` first.`,
    );
  }

  // created_by is nullable in the schema, but the service records a real
  // editor. Any member is enough; the oldest one is the closest to an owner.
  const memberRows = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, workspace.id))
    .orderBy(asc(workspaceMembers.createdAt))
    .limit(1);
  const authorId = memberRows[0]?.userId;
  if (!authorId) {
    throw new Error(
      `The "${WORKSPACE_SLUG}" workspace has no members. Sign in once, then rerun this import.`,
    );
  }

  const items: HelpImportItem[] = [];
  const seen = new Map<string, string>();
  for (const file of files) {
    const content = await readFile(path.join(HELP_DIRECTORY, file), "utf8");
    let item: HelpImportItem;
    try {
      item = parseMarkdownImport({ content, filename: file });
    } catch (error) {
      throw new Error(
        `${file}: ${error instanceof Error ? error.message : "could not be parsed"}`,
      );
    }

    const key = `${item.collection}/${item.slug}`;
    const previous = seen.get(key);
    if (previous) {
      throw new Error(`${file} and ${previous} both define ${key}.`);
    }
    seen.set(key, file);
    items.push(item);
  }

  const result = await importHelpItems({
    workspaceId: workspace.id,
    productId: product.id,
    userId: authorId,
    items,
    publish: true,
  });

  if (!result.ok) {
    throw new Error(result.error);
  }

  console.log(
    JSON.stringify(
      {
        workspace: `/p/${WORKSPACE_SLUG}/${PRODUCT_SLUG}/help`,
        articles: result.imported ?? items.length,
        warnings: result.warnings ?? [],
      },
      null,
      2,
    ),
  );

  if (result.warnings && result.warnings.length > 0) {
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
