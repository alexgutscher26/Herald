import { afterAll, beforeAll, describe, expect } from "bun:test";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { workspaceEmailIdentities } from "@/db/schema/email";
import { notificationDeliveries } from "@/db/schema/notifications";
import { subscribers } from "@/db/schema/subscribers";
import {
  cancellationReasons,
  customerAccounts,
  customerCancellations,
  releaseReasonLinks,
  winbackCampaignRecipients,
  winbackCampaigns,
} from "@/db/schema/winback";
import { saveSenderIdentity } from "@/features/email/identity";
import { suppressEmail } from "@/features/email/suppressions";
import { createPreferenceToken, updateSubscriberPreferences } from "@/features/subscribers/preferences";
import { parseCancellationCsv } from "@/features/winback/csv";
import {
  approveCampaign,
  createCampaign,
  getCampaignDetail,
  getWinbackAudience,
  getWinbackOverview,
  importCancellations,
  markRecipientReturned,
  sendCampaign,
  stopCampaign,
  submitCampaign,
} from "@/features/winback/service";
import { normalizeEmail } from "@/lib/email";

import {
  createProduct,
  createRelease,
  createUser,
  createWorkspace,
  uniqueLabel,
} from "./factories";
import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";

/**
 * Win-back campaigns against real Postgres.
 *
 * The campaign is the highest-risk email path: it imports eligibility, builds
 * a snapshot, requires a separate approval, and must re-check opt-outs at send
 * time. These tests exercise the real tables and the durable notification
 * outbox rather than a provider client.
 */

beforeAll(async () => {
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

async function tenant() {
  const workspace = await createWorkspace({ plan: "pro" });
  const product = await createProduct(workspace.id);
  const user = await createUser();
  return { workspace, product, user };
}

async function createAccount(
  productId: string,
  input: {
    email: string | null;
    name?: string;
    status?: "active" | "cancelled" | "reactivated" | "unknown";
    eligibility?: "unknown" | "eligible" | "ineligible";
    optedOutAt?: Date | null;
  },
) {
  const rows = await db
    .insert(customerAccounts)
    .values({
      productId,
      externalId: uniqueLabel("customer"),
      provider: "manual",
      email: input.email,
      emailNormalized: input.email ? normalizeEmail(input.email) : null,
      name: input.name ?? "Test customer",
      status: input.status ?? "cancelled",
      winbackEligibility: input.eligibility ?? "eligible",
      winbackOptedOutAt: input.optedOutAt ?? null,
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("Customer account insert returned no row.");
  return row;
}

async function configureSender(workspaceId: string, userId: string): Promise<void> {
  const result = await saveSenderIdentity({
    workspaceId,
    actorUserId: userId,
    fromName: "Acme Product",
    fromEmail: "updates@acme.com",
    replyTo: "support@acme.com",
    postalAddress: "Acme Inc., 123 Main Street, Springfield, IL 62701",
  });
  if (!result.ok) throw new Error(result.error);
  // Campaign fixtures bypass the mailbox click; mark the addresses verified
  // explicitly so the send path tests campaign behavior, not verification.
  await db
    .update(workspaceEmailIdentities)
    .set({ fromVerifiedAt: new Date(), replyToVerifiedAt: new Date() })
    .where(eq(workspaceEmailIdentities.workspaceId, workspaceId));
}

describe("cancellation import", () => {
  isolatedTest("is idempotent even when the CSV has no cancellation timestamp", async () => {
    const t = await tenant();
    const firstEmail = `${uniqueLabel("cancel-a")}@example.test`;
    const secondEmail = `${uniqueLabel("cancel-b")}@example.test`;
    const csv = [
      "email,name,reason,feedback",
      `${firstEmail},Ada,Too expensive,Needed a cheaper plan`,
      `${secondEmail},Grace,,`,
    ].join("\n");

    const firstParse = parseCancellationCsv(csv);
    expect(firstParse.rows).toHaveLength(2);
    expect(firstParse.rows[0]?.cancelledAtExplicit).toBe(false);
    const first = await importCancellations({
      workspaceId: t.workspace.id,
      productId: t.product.id,
      rows: firstParse.rows,
    });
    expect(first).toEqual({ created: 2, updated: 0, skipped: 0, total: 2 });

    const accounts = await db
      .select()
      .from(customerAccounts)
      .where(eq(customerAccounts.productId, t.product.id));
    expect(accounts).toHaveLength(2);
    expect(accounts.every((account) => account.status === "cancelled")).toBe(true);
    expect(accounts.every((account) => account.winbackEligibility === "eligible")).toBe(true);

    const reasons = await db
      .select({ label: cancellationReasons.label })
      .from(cancellationReasons)
      .where(eq(cancellationReasons.workspaceId, t.workspace.id));
    expect(reasons.map((reason) => reason.label)).toContain("Too expensive");

    // Parse again so the missing timestamps get a new wall-clock value. The
    // service must reuse the first cancellation instead of inserting a second.
    const second = await importCancellations({
      workspaceId: t.workspace.id,
      productId: t.product.id,
      rows: parseCancellationCsv(csv).rows,
    });
    expect(second).toEqual({ created: 0, updated: 2, skipped: 2, total: 2 });

    const cancellations = await db
      .select()
      .from(customerCancellations)
      .where(eq(customerCancellations.customerAccountId, accounts[0]?.id ?? ""));
    expect(cancellations).toHaveLength(1);
  });
});

describe("audience builder", () => {
  isolatedTest("accounts for every exclusion before a campaign is created", async () => {
    const t = await tenant();
    const eligibleEmail = `${uniqueLabel("eligible")}@example.test`;
    await createAccount(t.product.id, { email: eligibleEmail });
    await createAccount(t.product.id, {
      email: `${uniqueLabel("unknown")}@example.test`,
      eligibility: "unknown",
    });
    await createAccount(t.product.id, {
      email: `${uniqueLabel("opted-out")}@example.test`,
      optedOutAt: new Date(),
    });
    await createAccount(t.product.id, { email: null });

    const suppressedEmail = `${uniqueLabel("suppressed")}@example.test`;
    await createAccount(t.product.id, { email: suppressedEmail });
    await suppressEmail({
      workspaceId: t.workspace.id,
      email: suppressedEmail,
      reason: "hard_bounce",
    });

    const unsubscribedEmail = `${uniqueLabel("unsubscribed")}@example.test`;
    await createAccount(t.product.id, { email: unsubscribedEmail });
    await db.insert(subscribers).values({
      productId: t.product.id,
      email: unsubscribedEmail,
      emailNormalized: normalizeEmail(unsubscribedEmail),
      status: "unsubscribed",
      source: "manual",
    });

    const priorAccount = await createAccount(t.product.id, {
      email: `${uniqueLabel("prior")}@example.test`,
    });
    const priorRows = await db
      .insert(winbackCampaigns)
      .values({
        workspaceId: t.workspace.id,
        productId: t.product.id,
        name: "Earlier campaign",
        description: "An earlier message.",
        approvalStatus: "approved",
        sendStatus: "sent",
        sentAt: new Date(),
      })
      .returning({ id: winbackCampaigns.id });
    await db.insert(winbackCampaignRecipients).values({
      campaignId: priorRows[0]?.id ?? "",
      customerAccountId: priorAccount.id,
      email: priorAccount.email,
      emailNormalized: priorAccount.emailNormalized,
      status: "sent",
      sentAt: new Date(),
    });

    const audience = await getWinbackAudience({
      workspaceId: t.workspace.id,
      productId: t.product.id,
    });
    expect(audience.eligible.map((member) => member.email)).toEqual([eligibleEmail]);
    expect(audience.counts).toEqual({
      cancelled: 7,
      eligible: 1,
      excluded: 6,
      no_email: 1,
      ineligible: 1,
      unsubscribed: 2,
      winback_opted_out: 1,
      already_received: 1,
      segment_mismatch: 0,
    });
  });
});

async function approvedCampaign(
  t: Awaited<ReturnType<typeof tenant>>,
  count: number,
): Promise<{ campaignId: string; accounts: { id: string; email: string | null }[] }> {
  const accounts: { id: string; email: string | null }[] = [];
  for (let index = 0; index < count; index += 1) {
    const account = await createAccount(t.product.id, {
      email: `${uniqueLabel(`canary-${index}`)}@example.test`,
    });
    accounts.push({ id: account.id, email: account.email });
  }
  await configureSender(t.workspace.id, t.user.id);
  const created = await createCampaign({
    workspaceId: t.workspace.id,
    productId: t.product.id,
    actorUserId: t.user.id,
    name: "We fixed what you left for",
    description: "The problem you cancelled over is fixed. Come back and try it again.",
    releaseId: null,
  });
  if (!created.ok) throw new Error(created.error);
  const submitted = await submitCampaign({
    workspaceId: t.workspace.id,
    productId: t.product.id,
    campaignId: created.campaignId,
  });
  if (!submitted.ok) throw new Error(submitted.error);
  const approved = await approveCampaign({
    workspaceId: t.workspace.id,
    productId: t.product.id,
    campaignId: created.campaignId,
    actorUserId: t.user.id,
  });
  if (!approved.ok) throw new Error(approved.error);
  return { campaignId: created.campaignId, accounts };
}

describe("campaign lifecycle", () => {
  isolatedTest("requires approval, rechecks opt-outs, and never queues a duplicate", async () => {
    const t = await tenant();
    const first = await createAccount(t.product.id, {
      email: `${uniqueLabel("campaign-a")}@example.test`,
    });
    const second = await createAccount(t.product.id, {
      email: `${uniqueLabel("campaign-b")}@example.test`,
    });
    await createAccount(t.product.id, {
      email: `${uniqueLabel("campaign-ineligible")}@example.test`,
      eligibility: "ineligible",
    });
    const laterOptOut = await createAccount(t.product.id, {
      email: `${uniqueLabel("campaign-late-optout")}@example.test`,
    });

    const release = await createRelease({
      productId: t.product.id,
      title: "The reporting fix is live",
      status: "published",
    });
    const reasonRows = await db
      .insert(cancellationReasons)
      .values({ workspaceId: t.workspace.id, label: "Reporting was too slow" })
      .returning({ id: cancellationReasons.id });
    await db.insert(releaseReasonLinks).values({
      releaseId: release.id,
      cancellationReasonId: reasonRows[0]?.id ?? "",
    });

    const created = await createCampaign({
      workspaceId: t.workspace.id,
      productId: t.product.id,
      actorUserId: t.user.id,
      name: "Reporting is fixed",
      description: "The reporting problem you told us about is fixed. Come back and try it.",
      releaseId: release.id,
    });
    if (!created.ok) throw new Error(created.error);
    expect(created.audience).toMatchObject({ eligible: 3, excluded: 1 });

    const detail = await getCampaignDetail({
      workspaceId: t.workspace.id,
      productId: t.product.id,
      campaignId: created.campaignId,
    });
    expect(detail?.reasons.map((reason) => reason.label)).toEqual(["Reporting was too slow"]);
    expect(detail?.counts).toMatchObject({ total: 4, excluded: 1, queued: 0, sent: 0 });

    expect(
      await submitCampaign({
        workspaceId: t.workspace.id,
        productId: t.product.id,
        campaignId: created.campaignId,
      }),
    ).toEqual({ ok: true });

    expect(
      await approveCampaign({
        workspaceId: t.workspace.id,
        productId: t.product.id,
        campaignId: created.campaignId,
        actorUserId: t.user.id,
      }),
    ).toMatchObject({ ok: false });

    await configureSender(t.workspace.id, t.user.id);
    expect(
      await approveCampaign({
        workspaceId: t.workspace.id,
        productId: t.product.id,
        campaignId: created.campaignId,
        actorUserId: t.user.id,
      }),
    ).toEqual({ ok: true });

    // The audience was captured before this change; sending must re-check it.
    await db
      .update(customerAccounts)
      .set({ winbackOptedOutAt: new Date(), updatedAt: new Date() })
      .where(eq(customerAccounts.id, laterOptOut.id));

    const sent = await sendCampaign({
      workspaceId: t.workspace.id,
      productId: t.product.id,
      campaignId: created.campaignId,
      canary: true,
    });
    expect(sent).toEqual({ ok: true, queued: 2, excluded: 1, phase: "canary" });

    const deliveries = await db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.productId, t.product.id));
    expect(deliveries).toHaveLength(2);
    expect(deliveries.every((delivery) => delivery.template === "winback_campaign")).toBe(true);
    expect(new Set(deliveries.map((delivery) => delivery.dedupeKey)).size).toBe(2);

    const duplicate = await sendCampaign({
      workspaceId: t.workspace.id,
      productId: t.product.id,
      campaignId: created.campaignId,
    });
    expect(duplicate).toMatchObject({ ok: false });
    expect(
      await db
        .select({ id: notificationDeliveries.id })
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.productId, t.product.id)),
    ).toHaveLength(2);

    const afterSend = await getCampaignDetail({
      workspaceId: t.workspace.id,
      productId: t.product.id,
      campaignId: created.campaignId,
    });
    expect(afterSend?.campaign.sendStatus).toBe("sending");
    expect(afterSend?.counts).toMatchObject({ total: 4, excluded: 2, queued: 2, sent: 0 });

    const recipient = afterSend?.recipients.find(
      (item) => item.customerAccountId === first.id || item.customerAccountId === second.id,
    );
    if (!recipient) throw new Error("No queued recipient was captured.");
    expect(
      await markRecipientReturned({
        workspaceId: t.workspace.id,
        productId: t.product.id,
        campaignId: created.campaignId,
        recipientId: recipient.id,
        basis: "confirmed",
      }),
    ).toMatchObject({ ok: false });

    // Attribution is only valid after the provider accepts the message. The
    // worker is not run here, so mark this one delivery as sent directly.
    await db
      .update(winbackCampaignRecipients)
      .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
      .where(eq(winbackCampaignRecipients.id, recipient.id));
    expect(
      await markRecipientReturned({
        workspaceId: t.workspace.id,
        productId: t.product.id,
        campaignId: created.campaignId,
        recipientId: recipient.id,
        basis: "confirmed",
      }),
    ).toEqual({ ok: true });

    const returned = await getCampaignDetail({
      workspaceId: t.workspace.id,
      productId: t.product.id,
      campaignId: created.campaignId,
    });
    expect(returned?.counts.returned).toBe(1);
    expect(returned?.recipients.find((item) => item.id === recipient.id)).toMatchObject({
      attributionBasis: "confirmed",
    });

    const overview = await getWinbackOverview({
      workspaceId: t.workspace.id,
      productId: t.product.id,
    });
    expect(overview.campaigns[0]).toMatchObject({
      name: "Reporting is fixed",
      releaseTitle: "The reporting fix is live",
      recipients: 4,
      excluded: 2,
      queued: 1,
      sent: 1,
      returned: 1,
    });
  });

  isolatedTest("queues a canary batch first and unlocks the rest only after it settles", async () => {
    const t = await tenant();
    const { campaignId } = await approvedCampaign(t, 7);

    const canary = await sendCampaign({
      workspaceId: t.workspace.id,
      productId: t.product.id,
      campaignId,
      canary: true,
    });
    expect(canary).toEqual({ ok: true, queued: 5, excluded: 0, phase: "canary" });

    const blocked = await sendCampaign({
      workspaceId: t.workspace.id,
      productId: t.product.id,
      campaignId,
    });
    expect(blocked).toMatchObject({ ok: false });
    if (!blocked.ok) expect(blocked.error).toContain("canary");

    const afterCanary = await getCampaignDetail({
      workspaceId: t.workspace.id,
      productId: t.product.id,
      campaignId,
    });
    expect(afterCanary?.canary).toMatchObject({ recipientCount: 5, ready: false });
    expect(afterCanary?.counts).toMatchObject({ total: 7, queued: 5, sent: 0 });

    // The worker is not run here; settle the canary by hand so the remaining
    // audience can be released.
    await db
      .update(winbackCampaignRecipients)
      .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(winbackCampaignRecipients.campaignId, campaignId),
          eq(winbackCampaignRecipients.status, "queued"),
        ),
      );

    const settled = await getCampaignDetail({
      workspaceId: t.workspace.id,
      productId: t.product.id,
      campaignId,
    });
    expect(settled?.canary.ready).toBe(true);

    const rest = await sendCampaign({
      workspaceId: t.workspace.id,
      productId: t.product.id,
      campaignId,
    });
    expect(rest).toEqual({ ok: true, queued: 2, excluded: 0, phase: "remaining" });
  });

  isolatedTest("stops a campaign and skips every delivery that has not left yet", async () => {
    const t = await tenant();
    const { campaignId } = await approvedCampaign(t, 7);

    const canary = await sendCampaign({
      workspaceId: t.workspace.id,
      productId: t.product.id,
      campaignId,
      canary: true,
    });
    expect(canary).toMatchObject({ ok: true, queued: 5 });

    expect(
      await stopCampaign({
        workspaceId: t.workspace.id,
        productId: t.product.id,
        campaignId,
        actorUserId: t.user.id,
      }),
    ).toEqual({ ok: true });

    const detail = await getCampaignDetail({
      workspaceId: t.workspace.id,
      productId: t.product.id,
      campaignId,
    });
    expect(detail?.campaign.stoppedAt).not.toBeNull();
    expect(detail?.campaign.sendStatus).toBe("failed");
    expect(detail?.counts).toMatchObject({ total: 7, excluded: 7, queued: 0, sent: 0 });
    expect(detail?.excludedByReason).toEqual([{ reason: "campaign_stopped", count: 7 }]);

    const deliveries = await db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.productId, t.product.id));
    expect(deliveries).toHaveLength(5);
    expect(deliveries.every((delivery) => delivery.status === "skipped")).toBe(true);

    const afterStop = await sendCampaign({
      workspaceId: t.workspace.id,
      productId: t.product.id,
      campaignId,
    });
    expect(afterStop).toMatchObject({ ok: false });
    if (!afterStop.ok) expect(afterStop.error).toContain("stopped");
  });

  isolatedTest("re-checks global suppression immediately before sending", async () => {
    const t = await tenant();
    const { campaignId, accounts } = await approvedCampaign(t, 2);
    const suppressed = accounts[0];
    if (!suppressed?.email) throw new Error("Expected a suppressed test account.");
    await suppressEmail({
      workspaceId: t.workspace.id,
      email: suppressed.email,
      reason: "hard_bounce",
    });

    const sent = await sendCampaign({
      workspaceId: t.workspace.id,
      productId: t.product.id,
      campaignId,
      canary: true,
    });
    expect(sent).toMatchObject({ ok: true, queued: 1, excluded: 1 });

    const detail = await getCampaignDetail({
      workspaceId: t.workspace.id,
      productId: t.product.id,
      campaignId,
    });
    expect(
      detail?.recipients.find((item) => item.customerAccountId === suppressed.id),
    ).toMatchObject({ status: "excluded", exclusionReason: "unsubscribed" });
  });

  isolatedTest("refuses to attribute a return after the 30-day window", async () => {
    const t = await tenant();
    const { campaignId } = await approvedCampaign(t, 1);
    const sent = await sendCampaign({
      workspaceId: t.workspace.id,
      productId: t.product.id,
      campaignId,
      canary: true,
    });
    expect(sent).toMatchObject({ ok: true, queued: 1 });

    const detail = await getCampaignDetail({
      workspaceId: t.workspace.id,
      productId: t.product.id,
      campaignId,
    });
    const recipient = detail?.recipients[0];
    if (!recipient) throw new Error("No recipient was captured.");
    expect(detail?.attributionWindowDays).toBe(30);

    await db
      .update(winbackCampaignRecipients)
      .set({
        status: "sent",
        sentAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(),
      })
      .where(eq(winbackCampaignRecipients.id, recipient.id));

    const expired = await markRecipientReturned({
      workspaceId: t.workspace.id,
      productId: t.product.id,
      campaignId,
      recipientId: recipient.id,
      basis: "confirmed",
    });
    expect(expired).toMatchObject({ ok: false });
    if (!expired.ok) expect(expired.error).toContain("30-day");

    const closed = await getCampaignDetail({
      workspaceId: t.workspace.id,
      productId: t.product.id,
      campaignId,
    });
    expect(closed?.recipients[0]?.attributionOpen).toBe(false);

    await db
      .update(winbackCampaignRecipients)
      .set({
        sentAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(),
      })
      .where(eq(winbackCampaignRecipients.id, recipient.id));

    expect(
      await markRecipientReturned({
        workspaceId: t.workspace.id,
        productId: t.product.id,
        campaignId,
        recipientId: recipient.id,
        basis: "confirmed",
      }),
    ).toEqual({ ok: true });
  });

  isolatedTest("blocks sending when the linked release is not published", async () => {
    const t = await tenant();
    await createAccount(t.product.id, {
      email: `${uniqueLabel("draft-release")}@example.test`,
    });
    await configureSender(t.workspace.id, t.user.id);
    const release = await createRelease({
      productId: t.product.id,
      title: "Not shipped yet",
      status: "draft",
    });
    const created = await createCampaign({
      workspaceId: t.workspace.id,
      productId: t.product.id,
      actorUserId: t.user.id,
      name: "Not ready",
      description: "This campaign points at a release that has not shipped yet.",
      releaseId: release.id,
    });
    if (!created.ok) throw new Error(created.error);

    expect(
      await submitCampaign({
        workspaceId: t.workspace.id,
        productId: t.product.id,
        campaignId: created.campaignId,
      }),
    ).toEqual({ ok: true });
    expect(
      await approveCampaign({
        workspaceId: t.workspace.id,
        productId: t.product.id,
        campaignId: created.campaignId,
        actorUserId: t.user.id,
      }),
    ).toEqual({ ok: true });

    const sent = await sendCampaign({
      workspaceId: t.workspace.id,
      productId: t.product.id,
      campaignId: created.campaignId,
      canary: true,
    });
    expect(sent).toMatchObject({ ok: false });
    if (!sent.ok) expect(sent.error).toContain("published");

    expect(
      await db
        .select({ id: notificationDeliveries.id })
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.productId, t.product.id)),
    ).toHaveLength(0);
  });

  isolatedTest("refuses a release from another product", async () => {
    const t = await tenant();
    const other = await createProduct(t.workspace.id);
    const foreignRelease = await createRelease({
      productId: other.id,
      status: "published",
    });

    const created = await createCampaign({
      workspaceId: t.workspace.id,
      productId: t.product.id,
      actorUserId: t.user.id,
      name: "Wrong release",
      description: "This release belongs to a different product entirely.",
      releaseId: foreignRelease.id,
    });
    expect(created).toMatchObject({ ok: false });
  });
});

describe("win-back opt-out", () => {
  isolatedTest("preference changes reach the customer account and future audiences", async () => {
    const t = await tenant();
    const email = `${uniqueLabel("preference-optout")}@example.test`;
    const account = await createAccount(t.product.id, { email });
    const token = createPreferenceToken();
    await db.insert(subscribers).values({
      productId: t.product.id,
      email,
      emailNormalized: normalizeEmail(email),
      status: "active",
      source: "manual",
      unsubscribeToken: token,
    });

    const updated = await updateSubscriberPreferences(token, {
      productUpdates: true,
      winback: false,
    });
    expect(updated?.winback).toBe(false);

    const accountRows = await db
      .select({ winbackOptedOutAt: customerAccounts.winbackOptedOutAt })
      .from(customerAccounts)
      .where(and(eq(customerAccounts.productId, t.product.id), eq(customerAccounts.id, account.id)));
    expect(accountRows[0]?.winbackOptedOutAt).not.toBeNull();

    const audience = await getWinbackAudience({
      workspaceId: t.workspace.id,
      productId: t.product.id,
    });
    expect(audience.eligible).toHaveLength(0);
    expect(audience.counts.winback_opted_out).toBe(1);
  });
});
