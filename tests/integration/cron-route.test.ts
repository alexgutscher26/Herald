import { afterAll, beforeAll, describe, expect } from "bun:test";

import { GET } from "@/app/api/cron/jobs/route";
import { enqueueJob } from "@/features/jobs/queue";

import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";

/**
 * The scheduler's contract is the HTTP response, so the route is exercised
 * directly rather than only through the queue. It must expose per-type counts
 * and never a payload or a stored error message.
 */

const CRON_SECRET = "integration-cron-secret-0123456789";

type CronBody = {
  ok: boolean;
  claimed: number;
  byType: Record<
    string,
    { claimed: number; succeeded: number; failed: number; retrying: number }
  >;
  jobs: Array<{ id: string; type: string; status: string }>;
};

let previousSecret: string | undefined;

beforeAll(async () => {
  previousSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = CRON_SECRET;
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  if (previousSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previousSecret;
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

describe("GET /api/cron/jobs", () => {
  isolatedTest("returns per-type counts without job payloads", async () => {
    const job = await enqueueJob({
      type: "publish_releases",
      payload: { tenant: "must-not-appear" },
      dedupeKey: "route-run",
    });

    const response = await GET(
      new Request("http://localhost/api/cron/jobs", {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      }),
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as CronBody;
    expect(body.ok).toBe(true);
    // The route also schedules its idempotent daily analytics, purge and audit
    // jobs; the test asserts the requested release job specifically.
    expect(body.claimed).toBeGreaterThanOrEqual(1);
    expect(body.byType.publish_releases).toEqual({
      claimed: 1,
      succeeded: 1,
      failed: 0,
      retrying: 0,
    });
    expect(body.jobs).toContainEqual({
      id: job.id,
      type: "publish_releases",
      status: "succeeded",
    });

    const text = JSON.stringify(body);
    expect(text).not.toContain("must-not-appear");
    expect(text).not.toContain("payload");
    expect(text).not.toContain("lastError");
  });

  isolatedTest("rejects a request without the bearer secret", async () => {
    const response = await GET(new Request("http://localhost/api/cron/jobs"));
    expect(response.status).toBe(401);

    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });
});
