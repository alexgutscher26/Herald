import { afterAll, beforeAll, describe, expect } from "bun:test";
import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { emailSuppressions, jobs } from "@/db/schema";
import {
  buildDeliveryDedupeKey,
  notificationDeliveries,
} from "@/db/schema/notifications";
import { releases } from "@/db/schema/releases";
import { sendNotificationDelivery, sendTestEmail } from "@/features/email/send";
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
 * Outbound email through the real adapter.
 *
 * The provider boundary is an HTTP POST, so the test runs a local server and
 * points `EMAIL_API_URL` at it. That exercises the adapter, the outbox row and
 * the job handler end to end without replacing any module and without a live
 * vendor account. The local server can answer 429 to prove the retry path.
 */

const EMAIL_FROM = "Herald <updates@example.test>";
const API_KEY = "re_integration_local_key";

type ProviderRequest = {
  url: string;
  authorization: string | null;
  idempotencyKey: string | null;
  body: {
    from: string;
    to: string[];
    subject: string;
    html: string;
    text: string;
  };
};

let server: ReturnType<typeof Bun.serve> | null = null;
const providerRequests: ProviderRequest[] = [];
let providerStatus = 200;

let previous: Record<string, string | undefined> = {};

beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as ProviderRequest["body"];
      providerRequests.push({
        url: request.url,
        authorization: request.headers.get("authorization"),
        idempotencyKey: request.headers.get("idempotency-key"),
        body,
      });

      if (providerStatus !== 200) {
        return new Response(JSON.stringify({ message: "Try again later." }), {
          status: providerStatus,
          headers: { "content-type": "application/json" },
        });
      }

      return Response.json({ id: `msg_${providerRequests.length}` });
    },
  });

  previous = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    EMAIL_API_URL: process.env.EMAIL_API_URL,
    SANDBOX_MODE: process.env.SANDBOX_MODE,
  };
  // This suite measures the provider adapter; a local `.env` sandbox must not
  // short-circuit the delivery before the HTTP call.
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
  providerStatus = 200;
}, SETUP_TIMEOUT_MS);

async function seedDelivery(email = "reader@example.test") {
  const workspace = await createWorkspace();
  const product = await createProduct(workspace.id);

  const insertedReleases = await db
    .insert(releases)
    .values({
      productId: product.id,
      title: "Faster search",
      slug: uniqueLabel("release"),
      summary: "Search is twice as fast.",
      status: "published",
      publishedAt: new Date(),
    })
    .returning();

  const release = insertedReleases[0];
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
  return { workspace, product, release, delivery };
}

describe("outbound delivery", () => {
  isolatedTest("sends through the adapter and records the delivery as sent", async () => {
    const { delivery } = await seedDelivery();
    const dedupeKey = `send-email-${delivery.id}`;

    await enqueueJob({
      type: "send_email",
      payload: { deliveryId: delivery.id },
      dedupeKey,
    });

    const summary = await runDueJobs(5);
    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(0);

    const rows = await db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.id, delivery.id));
    const sent = rows[0];

    expect(sent?.status).toBe("sent");
    expect(sent?.attemptCount).toBe(1);
    expect(sent?.sentAt).not.toBeNull();
    expect(sent?.error).toBeNull();
    expect(sent?.providerMessageId).toBe(`msg_${providerRequests.length}`);

    const request = providerRequests.at(-1);
    expect(request?.url).toBe(process.env.EMAIL_API_URL);
    expect(request?.authorization).toBe(`Bearer ${API_KEY}`);
    expect(request?.idempotencyKey).toBe(delivery.dedupeKey);
    expect(request?.body.from).toBe(EMAIL_FROM);
    expect(request?.body.to).toEqual([delivery.recipientEmail]);
    expect(request?.body.subject).toContain("Faster search");
    expect(request?.body.html.length).toBeGreaterThan(0);
    expect(request?.body.text.length).toBeGreaterThan(0);
  });

  isolatedTest("sends the test email to the provider", async () => {
    const workspace = await createWorkspace();

    const result = await sendTestEmail({
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      to: "owner@example.test",
    });

    expect(result).toEqual({ ok: true, providerMessageId: `msg_${providerRequests.length}` });

    const request = providerRequests.at(-1);
    expect(request?.body.to).toEqual(["owner@example.test"]);
    expect(request?.body.subject).toContain("Test email from");
  });

  isolatedTest("a suppressed address is skipped without calling the provider", async () => {
    const { workspace, delivery } = await seedDelivery("suppressed@example.test");
    await suppressEmail({
      workspaceId: workspace.id,
      email: "suppressed@example.test",
      reason: "manual",
    });

    const requestsBefore = providerRequests.length;
    const outcome = await sendNotificationDelivery(delivery.id);

    expect(outcome.status).toBe("skipped");
    expect(providerRequests.length).toBe(requestsBefore);

    const [row] = await db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.id, delivery.id));
    expect(row?.status).toBe("skipped");
    expect(row?.attemptCount).toBe(1);
    expect(row?.error).toContain("suppression");
  });
});

describe("retry policy", () => {
  isolatedTest("a retryable failure records the error and backs off before retrying", async () => {
    providerStatus = 429;
    try {
      const { delivery } = await seedDelivery("retry@example.test");
      const dedupeKey = `retry-email-${delivery.id}`;

      await enqueueJob({
        type: "send_email",
        payload: { deliveryId: delivery.id },
        dedupeKey,
      });

      const first = await runDueJobs(5);
      expect(first.retrying).toBe(1);
      expect(first.failed).toBe(0);

      const [job] = await db.select().from(jobs).where(eq(jobs.dedupeKey, dedupeKey));
      expect(job?.status).toBe("pending");
      expect(job?.attempts).toBe(1);
      expect(job?.completedAt).toBeNull();
      expect(job?.lastError).toContain("HTTP 429");

      const firstDelay = (job?.runAt.getTime() ?? 0) - Date.now();
      expect(firstDelay).toBeGreaterThan(25_000);
      expect(firstDelay).toBeLessThanOrEqual(31_000);

      const [deliveryRow] = await db
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.id, delivery.id));
      expect(deliveryRow?.status).toBe("pending");
      expect(deliveryRow?.attemptCount).toBe(1);
      expect(deliveryRow?.error).toContain("HTTP 429");

      // The backoff is real: the job is not claimable again straight away.
      const requestsBefore = providerRequests.length;
      const immediate = await runDueJobs(5);
      expect(immediate.claimed).toBe(0);
      expect(providerRequests.length).toBe(requestsBefore);

      // The next scheduled attempt doubles the delay to one minute.
      await db
        .update(jobs)
        .set({ runAt: sql`now()` })
        .where(eq(jobs.id, job?.id ?? ""));

      const second = await runDueJobs(5);
      expect(second.retrying).toBe(1);

      const [retried] = await db.select().from(jobs).where(eq(jobs.dedupeKey, dedupeKey));
      expect(retried?.attempts).toBe(2);
      const secondDelay = (retried?.runAt.getTime() ?? 0) - Date.now();
      expect(secondDelay).toBeGreaterThan(55_000);
      expect(secondDelay).toBeLessThanOrEqual(61_000);

      // A retry reuses the delivery's idempotency key instead of sending twice
      // as far as the provider is concerned.
      const attempts = providerRequests.filter((request) =>
        request.body.to.includes(delivery.recipientEmail),
      );
      expect(attempts).toHaveLength(2);
      expect(
        attempts.every((request) => request.idempotencyKey === delivery.dedupeKey),
      ).toBe(true);

      providerStatus = 200;
      await db
        .update(jobs)
        .set({ runAt: sql`now()` })
        .where(eq(jobs.id, job?.id ?? ""));

      const third = await runDueJobs(5);
      expect(third.succeeded).toBe(1);

      const [finalDelivery] = await db
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.id, delivery.id));
      expect(finalDelivery?.status).toBe("sent");
      expect(finalDelivery?.attemptCount).toBe(3);
      expect(finalDelivery?.error).toBeNull();
      expect(finalDelivery?.providerMessageId).toBe(`msg_${providerRequests.length}`);
    } finally {
      providerStatus = 200;
    }
  });

  isolatedTest("sandbox mode skips email without calling the provider", async () => {
    const { delivery } = await seedDelivery();
    const previousSandbox = process.env.SANDBOX_MODE;
    process.env.SANDBOX_MODE = "on";
    try {
      const before = providerRequests.length;
      const outcome = await sendNotificationDelivery(delivery.id);
      expect(outcome).toMatchObject({ deliveryId: delivery.id, status: "skipped" });
      expect(providerRequests.length).toBe(before);

      const [row] = await db
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.id, delivery.id));
      expect(row?.status).toBe("skipped");
      expect(row?.error).toContain("Sandbox mode");

      const testSend = await sendTestEmail({
        workspaceId: delivery.workspaceId,
        workspaceName: "Sandbox",
        to: "reader@example.test",
      });
      expect(testSend).toMatchObject({ ok: false, retryable: false });
      expect(providerRequests.length).toBe(before);
    } finally {
      if (previousSandbox === undefined) delete process.env.SANDBOX_MODE;
      else process.env.SANDBOX_MODE = previousSandbox;
    }
  });
});

describe("provider server errors", () => {
  isolatedTest(
    "a 500 is retried to the attempt ceiling and never disturbs suppressions",
    async () => {
      providerStatus = 500;
      try {
        const { workspace, delivery } = await seedDelivery("provider-500@example.test");
        await suppressEmail({
          workspaceId: workspace.id,
          email: "unrelated@example.test",
          reason: "complaint",
          note: "Must survive a provider outage.",
        });

        const before = await db
          .select({ email: emailSuppressions.email, reason: emailSuppressions.reason })
          .from(emailSuppressions)
          .where(eq(emailSuppressions.workspaceId, workspace.id));
        expect(before).toHaveLength(1);

        const first = await sendNotificationDelivery(delivery.id);
        expect(first).toMatchObject({ status: "pending" });

        const second = await sendNotificationDelivery(delivery.id);
        expect(second).toMatchObject({ status: "pending" });

        const third = await sendNotificationDelivery(delivery.id);
        expect(third.status).toBe("failed");
        expect(third.error).toContain("HTTP 500");

        const [row] = await db
          .select()
          .from(notificationDeliveries)
          .where(eq(notificationDeliveries.id, delivery.id));
        expect(row?.status).toBe("failed");
        expect(row?.attemptCount).toBe(3);

        const after = await db
          .select({ email: emailSuppressions.email, reason: emailSuppressions.reason })
          .from(emailSuppressions)
          .where(eq(emailSuppressions.workspaceId, workspace.id));
        expect(after).toEqual(before);

        // The retried recipient was never added to the suppression list.
        expect(after.map((entry) => entry.email)).not.toContain(
          "provider-500@example.test",
        );
      } finally {
        providerStatus = 200;
      }
    },
    60_000,
  );
});
