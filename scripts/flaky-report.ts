/**
 * Flaky-test dashboard.
 *
 * Playwright writes `test-results/e2e-results.json` (the `json` reporter in
 * `playwright.e2e.config.ts`). This script flattens it into one row per test:
 * final status, attempts, and whether it is on the quarantine list. Retries
 * that eventually pass are the definition of flaky here.
 *
 * Output:
 *   - `test-results/flaky-dashboard.md`, uploaded as a CI artifact
 *   - the same table appended to `$GITHUB_STEP_SUMMARY`
 *
 * It never changes the job's exit code: the suite already failed if a test
 * failed. The dashboard exists to make flakes visible and to age the
 * quarantine list, not to hide a failure.
 */
import { readFile } from "node:fs/promises";

type PlaywrightResult = {
  status?: string;
  retry?: number;
  error?: { message?: string };
};

type PlaywrightTest = {
  title?: string;
  projectName?: string;
  status?: string;
  results?: PlaywrightResult[];
  tests?: PlaywrightTest[];
  specs?: PlaywrightTest[];
  suites?: PlaywrightTest[];
};

type Row = {
  name: string;
  project: string;
  status: string;
  attempts: number;
  retried: boolean;
  quarantined: boolean;
};

async function quarantineList(): Promise<string[]> {
  try {
    const parsed = JSON.parse(await readFile(".github/flaky-tests.json", "utf8")) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function collect(node: PlaywrightTest, rows: Row[], quarantine: string[]): void {
  if (Array.isArray(node.specs)) for (const spec of node.specs) collect(spec, rows, quarantine);
  if (Array.isArray(node.suites)) for (const suite of node.suites) collect(suite, rows, quarantine);

  if (!Array.isArray(node.tests)) return;
  for (const test of node.tests) {
    const results = test.results ?? [];
    const name = test.title ?? node.title ?? "(untitled)";
    const quarantined = quarantine.some((fragment) => name.includes(fragment));
    const attempts = results.length;
    const rawStatus = test.status ?? results.at(-1)?.status ?? "unknown";
    // Playwright's JSON reporter calls a normal pass "expected".
    const status = rawStatus === "expected" ? "passed" : rawStatus;
    rows.push({
      name,
      project: test.projectName ?? "",
      status,
      attempts,
      retried: attempts > 1,
      quarantined,
    });
  }
}

const path = process.env.PLAYWRIGHT_JSON ?? "test-results/e2e-results.json";
let report: PlaywrightTest;
try {
  report = JSON.parse(await readFile(path, "utf8")) as PlaywrightTest;
} catch {
  console.error(`flaky-report: no Playwright JSON at ${path}; nothing to summarise.`);
  process.exit(0);
}

const quarantine = await quarantineList();
const rows: Row[] = [];
collect(report, rows, quarantine);

const flaky = rows.filter((row) => row.retried);
const failed = rows.filter((row) => row.status === "failed" || row.status === "timedOut");
const quarantined = rows.filter((row) => row.quarantined);

const lines = [
  "# Flaky test dashboard",
  "",
  `Tests: ${rows.length} · flaky (passing after a retry): ${flaky.length} · failed: ${failed.length} · quarantined: ${quarantined.length}`,
  "",
  "| Test | Project | Status | Attempts | Quarantined |",
  "| --- | --- | --- | ---: | --- |",
  ...[...rows]
    .sort((left, right) => Number(right.retried) - Number(left.retried))
    .map(
      (row) =>
        `| ${row.name.replaceAll("|", "\\|")} | ${row.project} | ${row.status} | ${row.attempts} | ${row.quarantined ? "yes" : "no"} |`,
    ),
  "",
  "Flaky means a retry was needed. Quarantined tests are listed in `.github/flaky-tests.json`; see `docs/flaky-tests.md` for the exit criteria.",
  "",
].join("\n");

await Bun.write("test-results/flaky-dashboard.md", lines);
if (process.env.GITHUB_STEP_SUMMARY) {
  await Bun.write(process.env.GITHUB_STEP_SUMMARY, lines, { createPath: true });
}

console.log(
  JSON.stringify(
    { tests: rows.length, flaky: flaky.length, failed: failed.length, quarantined: quarantined.length },
    null,
    2,
  ),
);
