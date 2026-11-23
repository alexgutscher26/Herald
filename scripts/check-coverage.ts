/**
 * P0 coverage floor.
 *
 * Reads `coverage/lcov.info` (Bun: `--coverage-reporter=lcov`) and computes
 * line coverage for the four modules where a silent regression is a security
 * or revenue incident: authentication, tenancy, billing and the public API.
 *
 * The floor is deliberately below today's measured value: it is a ratchet
 * against erosion, not a target that encourages testing getters. Raise a floor
 * in the same change that raises the coverage.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

type Group = { name: string; prefixes: string[]; floor: number };

const GROUPS: Group[] = [
  {
    name: "auth",
    prefixes: [
      "src/lib/auth.ts",
      "src/features/auth/",
      "src/features/customer-auth/",
      "src/features/customer-session/",
    ],
    floor: 70,
  },
  {
    name: "tenancy",
    prefixes: [
      "src/lib/authz.ts",
      "src/db/queries/workspaces.ts",
      "src/db/queries/boards.ts",
      "src/features/workspace-settings/",
    ],
    floor: 70,
  },
  {
    name: "billing",
    prefixes: ["src/features/billing/"],
    floor: 40,
  },
  {
    name: "api-v1",
    prefixes: ["src/features/api-v1/"],
    floor: 70,
  },
];

type Record = { file: string; linesFound: number; linesHit: number };

function normalise(file: string): string {
  return path.relative(process.cwd(), path.resolve(file)).replaceAll("\\", "/");
}

function parseLcov(text: string): Record[] {
  const records: Record[] = [];
  let file = "";
  let linesFound = 0;
  let linesHit = 0;

  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("SF:")) {
      file = line.slice(3);
      linesFound = 0;
      linesHit = 0;
    } else if (line.startsWith("LF:")) {
      linesFound = Number.parseInt(line.slice(3), 10) || 0;
    } else if (line.startsWith("LH:")) {
      linesHit = Number.parseInt(line.slice(3), 10) || 0;
    } else if (line === "end_of_record" && file) {
      records.push({ file: normalise(file), linesFound, linesHit });
      file = "";
    }
  }
  return records;
}

function percent(hit: number, found: number): number {
  return found === 0 ? 100 : Math.round((hit / found) * 1000) / 10;
}

const reportPath = process.env.COVERAGE_LCOV ?? "coverage/lcov.info";
let text: string;
try {
  text = await readFile(reportPath, "utf8");
} catch {
  console.error(`check-coverage: ${reportPath} is missing. Run the coverage script first.`);
  process.exit(1);
}

const records = parseLcov(text);
if (records.length === 0) {
  console.error("check-coverage: the lcov report has no source records.");
  process.exit(1);
}

const results = GROUPS.map((group) => {
  const matching = records.filter((record) =>
    group.prefixes.some((prefix) =>
      prefix.endsWith("/") ? record.file.startsWith(prefix) : record.file === prefix,
    ),
  );
  const found = matching.reduce((sum, record) => sum + record.linesFound, 0);
  const hit = matching.reduce((sum, record) => sum + record.linesHit, 0);
  const coverage = percent(hit, found);
  return {
    module: group.name,
    linesFound: found,
    linesHit: hit,
    percent: coverage,
    floor: group.floor,
    passed: found > 0 && coverage >= group.floor,
  };
});

console.table(results.map(({ module, percent, floor, passed }) => ({ module, percent, floor, passed })));

const markdown = [
  "### P0 coverage",
  "",
  "| Module | Line coverage | Floor | Status |",
  "| --- | ---: | ---: | --- |",
  ...results.map(
    (result) =>
      `| ${result.module} | ${result.percent}% | ${result.floor}% | ${result.passed ? "ok" : "below floor"} |`,
  ),
  "",
].join("\n");

await Bun.write("coverage/summary.md", markdown);
if (process.env.GITHUB_STEP_SUMMARY) {
  await Bun.write(process.env.GITHUB_STEP_SUMMARY, markdown, { createPath: true });
}

const failed = results.filter((result) => !result.passed);
if (failed.length > 0) {
  console.error(
    `check-coverage: below floor: ${failed
      .map((result) => `${result.module} ${result.percent}% < ${result.floor}%`)
      .join(", ")}`,
  );
  process.exit(1);
}
