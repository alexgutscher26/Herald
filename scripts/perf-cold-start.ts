/**
 * Cold-start probe.
 *
 * Start the production server immediately before running this, with nothing
 * having requested a page yet. The probe retries the first path until the
 * process answers, so the reported time covers process boot, route matching and
 * the first render/query — the cost a visitor pays after a deploy or a scale-up.
 *
 *   PERF_ORIGIN=http://localhost:3000 \
 *   PERF_COLD_PATHS="/p/perf/feedback/feedback,/api/health?scope=readiness" \
 *   bun run perf:cold
 *
 * Only the first path is cold. The remaining paths are measured immediately
 * after it (a warm process) and are there to check that readiness and the DB
 * path answer quickly once the site is serving.
 *
 * Environment:
 *   PERF_ORIGIN        origin to probe (required)
 *   PERF_COLD_PATHS    comma-separated paths (default `/api/health?scope=readiness`)
 *   PERF_COLD_MS       budget for the first path, in ms (default 5000)
 *   PERF_COLD_TIMEOUT_MS  how long to wait for the server (default 60000)
 */
export {};

const perfOrigin = process.env.PERF_ORIGIN?.trim();
if (!perfOrigin) {
  console.error("PERF_ORIGIN is required.");
  process.exit(1);
}

const paths = (process.env.PERF_COLD_PATHS ?? "/api/health?scope=readiness")
  .split(",")
  .map((path) => path.trim())
  .filter((path) => path.length > 0);
if (paths.length === 0) {
  console.error("PERF_COLD_PATHS did not contain a path.");
  process.exit(1);
}

const budgetMs = Math.min(
  Math.max(Number(process.env.PERF_COLD_MS ?? 5000) || 5000, 1),
  120_000,
);
const timeoutMs = Math.min(
  Math.max(Number(process.env.PERF_COLD_TIMEOUT_MS ?? 60_000) || 60_000, 1_000),
  600_000,
);

type Result = {
  path: string;
  firstResponseMs: number;
  status: number;
  attempts: number;
  passed: boolean;
};

const results: Result[] = [];

for (const path of paths) {
  const started = performance.now();
  const deadline = started + timeoutMs;
  let attempts = 0;
  let status = 0;
  let reached = false;

  while (performance.now() < deadline) {
    attempts += 1;
    try {
      const response = await fetch(`${perfOrigin}${path}`, {
        redirect: "manual",
        signal: AbortSignal.timeout(Math.max(1_000, Math.min(budgetMs, 10_000))),
      });
      status = response.status;
      // Any HTTP answer proves the process is up; a non-2xx is still a failed
      // cold start for a page, so it is reported rather than retried forever.
      await response.arrayBuffer().catch(() => undefined);
      reached = true;
      break;
    } catch {
      await Bun.sleep(100);
    }
  }

  const firstResponseMs = Math.round(performance.now() - started);
  results.push({
    path,
    firstResponseMs,
    status,
    attempts,
    passed: reached && status >= 200 && status < 300 && firstResponseMs <= budgetMs,
  });
}

console.log(
  JSON.stringify(
    {
      origin: perfOrigin,
      coldBudgetMs: budgetMs,
      timeoutMs,
      results,
      note: "Only the first path is measured from a cold process; the rest run immediately after it.",
    },
    null,
    2,
  ),
);

if (results.some((result) => !result.passed)) process.exitCode = 1;
