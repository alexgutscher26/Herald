/**
 * Small HTTP load test for a public page. It does not seed data; use
 * `scripts/perf-seed.ts` first against a disposable database.
 *
 *   PERF_URL=http://localhost:3000/p/perf/feedback/feedback \
 *   PERF_REQUESTS=300 PERF_CONCURRENCY=20 bun scripts/perf-load.ts
 */
export {};

const url = process.env.PERF_URL;
if (!url) {
  console.error("PERF_URL is required.");
  process.exit(1);
}
const targetUrl = url;
const requests = Math.min(Math.max(Number(process.env.PERF_REQUESTS ?? 300) || 300, 1), 5000);
const concurrency = Math.min(
  Math.max(Number(process.env.PERF_CONCURRENCY ?? 20) || 20, 1),
  requests,
);
const targetP95 = Number(process.env.PERF_P95_MS ?? 500);
// Bearer authentication for `/api/v1` measurements; public pages need none.
const authorization = process.env.PERF_AUTHORIZATION;

const durations: number[] = [];
let failures = 0;
let cursor = 0;

async function worker(): Promise<void> {
  while (true) {
    const index = cursor++;
    if (index >= requests) return;
    const started = performance.now();
    try {
      const response = await fetch(targetUrl, {
        redirect: "manual",
        headers: authorization ? { authorization } : {},
      });
      if (!response.ok) failures += 1;
    } catch {
      failures += 1;
    } finally {
      durations.push(performance.now() - started);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
durations.sort((a, b) => a - b);
const percentile = (fraction: number) =>
  durations[Math.min(durations.length - 1, Math.floor(durations.length * fraction))] ?? 0;
const p50 = percentile(0.5);
const p95 = percentile(0.95);

console.log(
  JSON.stringify(
    {
      url: targetUrl,
      requests,
      concurrency,
      p50Ms: Math.round(p50),
      p95Ms: Math.round(p95),
      failures,
      targetP95Ms: targetP95,
    },
    null,
    2,
  ),
);

if (failures > 0 || p95 > targetP95) process.exitCode = 1;
