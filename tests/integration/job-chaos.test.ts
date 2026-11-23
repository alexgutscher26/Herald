import { afterAll, beforeAll, describe, expect } from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { emailSuppressions } from "@/db/schema";
import { jobs } from "@/db/schema/jobs";
import {
  buildDeliveryDedupeKey,
  notificationDeliveries,
} from "@/db/schema/notifications";
import { releases } from "@/db/schema/releases";
import { suppressEmail } from "@/features/email/suppressions";
import { enqueueJob, runDueJobs } from "@/features/jobs/queue";
import { normalizeEmail } from "@/lib/email";

import { createProduct, createWorkspace, uniqueLabel } from "./factories";
import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";

/**
 * Job runner chaos: the process dies after claiming, before finishing.
 *
 * A runner that takes a job and is killed leaves `status = running` and an old
 * `locked_at`. The next invocation must reclaim it after the stale window,
 * finish it, and still deliver exactly once. The provider is a real local HTTP
 * server; the "crash" is the exact database state a killed process leaves
 * behind, because there is no way to reliably SIGKILL a Bun child mid-await
 * from inside the same test process.
 */

const API_KEY = "re_chaos_local_key";
const EMAIL_FROM = "Herald <chaos@example.test>";

let server: ReturnType<typeof Bun.serve> | null = null;
let providerRequests = 0;
let previous: Record<string, string | undefined> = {};

beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      providerRequests += 1;
      await request.text();
      return Response.json({ id: `msg_chaos_${providerRequests}` });
    },
  });

  previous = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    EMAIL_API_URL: process.env.EMAIL_API_URL,
    SANDBOX_MODE: process.env.SANDBOX_MODE,
  };
  // The delivery must reach the local provider, not sandbox-skip.
  delete process.env.SANDBOX_MODE;
  process.env.RESEND_API_KEY = API_KEY;
  process.env.EMAIL_FROM = EMAIL_FROM;
  process.env.EMAIL_API_URL = `http://127.0.0.1:${server.port}/emails`;

  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await teardownTestDatabase();
  server?.stop(true);
  server = null;
}, SETUP_TIMEOUT_MS);

async function seedDelivery(email: string) {
  const workspace = await createWorkspace();
  const product = await createProduct(workspace.id);
  const inserted = await db
    .insert(releases)
    .values({
      productId: product.id,
      title: "Chaos-safe delivery",
      slug: uniqueLabel("release"),
      summary: "A release that must be sent exactly once.",
      status: "published",
      publishedAt: new Date(),
    })
    .returning();
  const release = inserted[0];
  if (!release) throw new Error("Release insert returned no row.");

  const emailNormalized = normalizeEmail(email);
  const rows = await db
    .insert(notificationDeliveries)
    .values({
      workspaceId: workspace.id,
      productId: product.id,
      template: "release_published",
      releaseId: release.id,
      recipientEmail: email,
      recipientEmailNormalized: emailNormalized,
      status: "pending",
      dedupeKey: buildDeliveryDedupeKey({
        template: "release_published",
        productId: product.id,
        recipientEmailNormalized: emailNormalized,
        sourceId: release.id,
      }),
    })
    .returning();
  const delivery = rows[0];
  if (!delivery) throw new Error("Delivery insert returned no row.");
  return delivery;
}

describe("job runner recovery", () => {
  isolatedTest("a runner killed after claiming is reclaimed and sends once", async () => {
    const delivery = await seedDelivery("chaos@example.test");
    await suppressEmail({
      workspaceId: delivery.workspaceId,
      email: "someone-else@example.test",
      reason: "complaint",
      note: "Unrelated suppression that must survive the retry.",
    });

    const enqueued = await enqueueJob({
      type: "deliver_notification",
      payload: {},
      dedupeKey: `chaos-delivery-${delivery.id}`,
    });

    // The crashed runner's footprint: claimed, locked in the past, never
    // completed. `runDueJobs` releases locks older than ten minutes.
    await db
      .update(jobs)
      .set({
        status: "running",
        lockedAt: new Date(Date.now() - 11 * 60 * 1000),
        attempts: 1,
      })
      .where(eq(jobs.id, enqueued.id));

    const recovered = await runDueJobs(5);
    expect(recovered.succeeded).toBe(1);
    expect(recovered.failed).toBe(0);

    const deliveryRows = await db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.id, delivery.id));
    expect(deliveryRows[0]?.status).toBe("sent");
    expect(deliveryRows[0]?.attemptCount).toBe(1);
    expect(providerRequests).toBe(1);

    const jobRows = await db.select().from(jobs).where(eq(jobs.id, enqueued.id));
    expect(jobRows[0]?.status).toBe("succeeded");
    expect(jobRows[0]?.attempts).toBe(2);

    // A second sweep must not send it again: the outbox row is terminal.
    await runDueJobs(5);
    expect(providerRequests).toBe(1);

    // Recovery must not rewrite unrelated suppression state.
    const suppressed = await db
      .select({ email: emailSuppressions.email })
      .from(emailSuppressions)
      .where(eq(emailSuppressions.workspaceId, delivery.workspaceId));
    expect(suppressed).toEqual([{ email: "someone-else@example.test" }]);
  }, 60_000);
});
