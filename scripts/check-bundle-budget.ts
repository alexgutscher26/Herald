/**
 * Fail the production build when a shipped bundle grows past its budget.
 *
 * Runs as `postbuild`, so `bun run build` fails on a regression instead of
 * shipping one. The widget files are also covered by
 * `tests/widget-budget.test.ts`; the ceilings live in `bundle-budgets.ts` so
 * both checks agree.
 *
 *   bun scripts/check-bundle-budget.ts
 *
 * Set `BUNDLE_BUDGET_REPORT=1` to print measurements without enforcing.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { DASHBOARD_BUDGETS, WIDGET_BUDGETS } from "./bundle-budgets";

const root = process.cwd();
const nextDir = path.join(root, ".next");
const appDir = path.join(nextDir, "server", "app");
const reportOnly = process.env.BUNDLE_BUDGET_REPORT === "1";

type Failure = { label: string; actual: number; budget: number };

const failures: Failure[] = [];

function formatBytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function check(label: string, actual: number, budget: number): void {
  const status = actual <= budget ? "ok" : "OVER";
  console.log(
    `${status.padEnd(4)} ${label.padEnd(38)} ${formatBytes(actual).padStart(10)} / ${formatBytes(budget)}`,
  );
  if (actual > budget) failures.push({ label, actual, budget });
}

async function gzippedSize(file: string): Promise<number> {
  return gzipSync(await readFile(file)).byteLength;
}

/* -------------------------------------------------------------------------- */
/* Widget                                                                    */
/* -------------------------------------------------------------------------- */

for (const budget of WIDGET_BUDGETS) {
  const file = path.join(root, budget.file);
  const contents = await readFile(file);
  const gzipped = gzipSync(contents).byteLength;
  check(`${budget.file} raw`, contents.byteLength, budget.rawBytes);
  check(`${budget.file} gzip`, gzipped, budget.gzipBytes);
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                 */
/* -------------------------------------------------------------------------- */

async function findManifests(directory: string): Promise<string[]> {
  const found: string[] = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await findManifests(full)));
    else if (entry.name === "page_client-reference-manifest.js") found.push(full);
  }
  return found;
}

type ClientManifest = {
  entryJSFiles?: Record<string, string[]>;
  entryCSSFiles?: Record<string, { path: string }[]>;
};

function readManifest(source: string): Record<string, ClientManifest> {
  const scope: { __RSC_MANIFEST?: Record<string, ClientManifest> } = {};
  // The generated file assigns `globalThis.__RSC_MANIFEST[...] = {...}`.
  new Function("globalThis", source)(scope);
  return scope.__RSC_MANIFEST ?? {};
}

/** A chunk path in a manifest may be `/...` or `_next/...`; normalise it. */
function chunkFile(chunk: string): string {
  const cleaned = chunk.replace(/^\/+/, "").replace(/^_next\//, "");
  return path.join(nextDir, cleaned);
}

type Bundle = { js: Set<string>; css: Set<string> };

function addEntries(
  bundle: Bundle,
  manifest: ClientManifest,
  entryFilter: (name: string) => boolean,
): void {
  for (const [name, chunks] of Object.entries(manifest.entryJSFiles ?? {})) {
    if (!entryFilter(name)) continue;
    for (const chunk of chunks) bundle.js.add(chunkFile(chunk));
  }
  for (const [name, files] of Object.entries(manifest.entryCSSFiles ?? {})) {
    if (!entryFilter(name)) continue;
    for (const file of files) bundle.css.add(chunkFile(file.path));
  }
}

const manifests = await findManifests(appDir);
if (manifests.length === 0) {
  console.error("No client reference manifests found. Run `bun run build` first.");
  process.exit(1);
}

const routeBundle: Bundle = { js: new Set(), css: new Set() };
const allBundle: Bundle = { js: new Set(), css: new Set() };

const feedbackManifestPath = manifests.find(
  (file) =>
    file.includes("(dashboard)") &&
    file.replaceAll(path.sep, "/").endsWith("/feedback/page_client-reference-manifest.js"),
);

for (const file of manifests) {
  const source = await readFile(file, "utf8");
  for (const manifest of Object.values(readManifest(source))) {
    addEntries(allBundle, manifest, (name) => name.includes("src/app/(dashboard)"));
  }
}

if (feedbackManifestPath) {
  const source = await readFile(feedbackManifestPath, "utf8");
  for (const manifest of Object.values(readManifest(source))) {
    addEntries(
      routeBundle,
      manifest,
      (name) =>
        name.endsWith("src/app/layout") ||
        name.includes("/app/[workspaceSlug]/[productSlug]/layout") ||
        name.endsWith("/feedback/page"),
    );
  }
} else {
  console.error("The feedback route has no client reference manifest.");
  process.exit(1);
}

async function totalGzip(files: Set<string>): Promise<number> {
  let total = 0;
  for (const file of files) {
    // A manifest can name a chunk that was pruned; a missing file must fail
    // the check rather than silently reduce the measured bundle.
    await stat(file);
    total += await gzippedSize(file);
  }
  return total;
}

check(
  "dashboard feedback route js",
  await totalGzip(routeBundle.js),
  DASHBOARD_BUDGETS.routeJsGzipBytes,
);
check(
  "dashboard feedback route css",
  await totalGzip(routeBundle.css),
  DASHBOARD_BUDGETS.routeCssGzipBytes,
);
check("dashboard all routes js", await totalGzip(allBundle.js), DASHBOARD_BUDGETS.allJsGzipBytes);

console.log(
  `\nchunks: feedback route ${routeBundle.js.size} js / ${routeBundle.css.size} css, ` +
    `all dashboard routes ${allBundle.js.size} js`,
);

if (!reportOnly && failures.length > 0) {
  console.error(
    `\nBundle budget exceeded: ${failures
      .map((failure) => `${failure.label} ${formatBytes(failure.actual)} > ${formatBytes(failure.budget)}`)
      .join(", ")}.`,
  );
  process.exit(1);
}
