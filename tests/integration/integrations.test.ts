import { afterAll, beforeAll, describe, expect } from "bun:test";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  customerCompanies,
  customerCompanyMemberships,
  crmConnections,
  customers,
  feedbackPosts,
  feedbackStatusHistory,
  issueLinks,
  issueSyncEvents,
  jobs,
  workspaceAuditEvents,
} from "@/db/schema";
import {
  createIssueForFeedback,
  getFeedbackIntegrationView,
  linkExistingIssue,
  listIssueConnectionsForSettings,
  processIssueTrackerEvent,
  pushFeedbackStatusToIssueTracker,
  saveIssueConnection,
} from "@/features/integrations/issue-service";
import { defaultStatusMap } from "@/features/integrations/issue-providers";
import {
  enqueueCrmConnectionSync,
  saveCrmConnection,
  syncCrmConnection,
} from "@/features/integrations/crm-service";

import {
  createBoard,
  createCustomer,
  createFeedbackPost,
  createMember,
  createProduct,
  createWorkspace,
} from "./factories";
import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";

/**
 * Real-Postgres coverage for issue-tracker sync and CRM caching.
 *
 * Each test runs inside a transaction that is rolled back, so the unique
 * constraints, composite foreign keys and dedupe keys are the production ones.
 */

beforeAll(async () => {
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

type FakeFetch = {
  impl: typeof fetch;
  calls: { url: string; init: RequestInit | undefined }[];
};

function fakeFetch(
  handler: (url: string, init: RequestInit | undefined) => { status?: number; body: unknown },
): FakeFetch {
  const calls: FakeFetch["calls"] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    const result = handler(url, init);
    return new Response(JSON.stringify(result.body), {
      status: result.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const linearIssueResponse = {
  data: {
    issueCreate: {
      success: true,
      issue: {
        id: "linear-issue-1",
        identifier: "HER-1",
        url: "https://linear.app/acme/issue/HER-1",
        state: { name: "Triage" },
      },
    },
  },
};

async function linearConnection(workspaceId: string, productId: string, userId: string) {
  const saved = await saveIssueConnection({
    workspaceId,
    productId,
    userId,
    provider: "linear",
    name: "Linear",
    config: { teamId: "team-1" },
    statusMap: defaultStatusMap("linear"),
    apiToken: "lin_api_secret_value",
    webhookSecret: "linear-webhook-secret",
  });
  if (!saved.ok) throw new Error(saved.error);
  return saved.id;
}

describe("issue tracker sync", () => {
  isolatedTest("creates exactly one external issue across repeated attempts", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const product = await createProduct(workspace.id);
    const board = await createBoard(product.id);
    const post = await createFeedbackPost({ productId: product.id, boardId: board.id });
    const { user } = await createMember(workspace.id, { role: "owner" });
    const connectionId = await linearConnection(workspace.id, product.id, user.id);

    const tracker = fakeFetch(() => ({ body: linearIssueResponse }));

    const first = await createIssueForFeedback({
      workspaceId: workspace.id,
      productId: product.id,
      userId: user.id,
      feedbackPostId: post.id,
      provider: "linear",
      fetchImpl: tracker.impl,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.error);
    expect(first.created).toBe(true);
    expect(first.link.externalKey).toBe("HER-1");
    expect(first.link.state).toBe("linked");

    const second = await createIssueForFeedback({
      workspaceId: workspace.id,
      productId: product.id,
      userId: user.id,
      feedbackPostId: post.id,
      provider: "linear",
      fetchImpl: tracker.impl,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(second.error);
    expect(second.created).toBe(false);
    expect(tracker.calls).toHaveLength(1);

    const links = await db
      .select()
      .from(issueLinks)
      .where(eq(issueLinks.connectionId, connectionId));
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      state: "linked",
      externalId: "linear-issue-1",
      externalKey: "HER-1",
      createdBy: user.id,
    });

    const events = await db
      .select()
      .from(issueSyncEvents)
      .where(eq(issueSyncEvents.connectionId, connectionId));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      direction: "outbound",
      action: "issue.create",
      outcome: "succeeded",
      actorUserId: user.id,
    });
  });

  isolatedTest("a failed creation stays failed and can be linked manually", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const product = await createProduct(workspace.id);
    const post = await createFeedbackPost({ productId: product.id });
    const { user } = await createMember(workspace.id, { role: "owner" });

    const saved = await saveIssueConnection({
      workspaceId: workspace.id,
      productId: product.id,
      userId: user.id,
      provider: "github",
      name: "GitHub",
      config: { owner: "acme", repo: "widgets" },
      statusMap: defaultStatusMap("github"),
      apiToken: "ghp_secret_token",
      webhookSecret: "github-webhook-secret",
    });
    if (!saved.ok) throw new Error(saved.error);

    const tracker = fakeFetch(() => ({ status: 500, body: { message: "boom" } }));
    const failed = await createIssueForFeedback({
      workspaceId: workspace.id,
      productId: product.id,
      userId: user.id,
      feedbackPostId: post.id,
      provider: "github",
      fetchImpl: tracker.impl,
    });
    expect(failed.ok).toBe(false);

    const [pending] = await db.select().from(issueLinks).where(eq(issueLinks.connectionId, saved.id));
    expect(pending?.state).toBe("failed");
    expect(pending?.lastError).toBeTruthy();

    const retry = await createIssueForFeedback({
      workspaceId: workspace.id,
      productId: product.id,
      userId: user.id,
      feedbackPostId: post.id,
      provider: "github",
      fetchImpl: tracker.impl,
    });
    expect(retry.ok).toBe(false);
    if (!retry.ok) expect(retry.error).toContain("Link the issue manually");
    expect(tracker.calls).toHaveLength(1);

    const linked = await linkExistingIssue({
      workspaceId: workspace.id,
      productId: product.id,
      userId: user.id,
      feedbackPostId: post.id,
      provider: "github",
      externalId: "42",
      externalKey: "#42",
      externalUrl: "https://github.com/acme/widgets/issues/42",
    });
    expect(linked.ok).toBe(true);
    if (!linked.ok) throw new Error(linked.error);
    expect(linked.link.state).toBe("linked");

    const [row] = await db.select().from(issueLinks).where(eq(issueLinks.id, pending!.id));
    expect(row).toMatchObject({ state: "linked", externalKey: "#42", lastError: null });
  });

  isolatedTest("a Herald status change pushes to the linked issue", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const product = await createProduct(workspace.id);
    const post = await createFeedbackPost({ productId: product.id, status: "in_progress" });
    const { user } = await createMember(workspace.id, { role: "owner" });

    const saved = await saveIssueConnection({
      workspaceId: workspace.id,
      productId: product.id,
      userId: user.id,
      provider: "github",
      name: "GitHub",
      config: { owner: "acme", repo: "widgets" },
      statusMap: defaultStatusMap("github"),
      apiToken: "ghp_secret_token",
      webhookSecret: "github-webhook-secret",
    });
    if (!saved.ok) throw new Error(saved.error);

    const linked = await linkExistingIssue({
      workspaceId: workspace.id,
      productId: product.id,
      userId: user.id,
      feedbackPostId: post.id,
      provider: "github",
      externalId: "42",
      externalKey: "#42",
      externalUrl: "https://github.com/acme/widgets/issues/42",
    });
    if (!linked.ok) throw new Error(linked.error);

    const tracker = fakeFetch(() => ({ body: { state: "closed" } }));
    const result = await pushFeedbackStatusToIssueTracker({
      productId: product.id,
      feedbackPostId: post.id,
      fromStatus: "in_progress",
      toStatus: "shipped",
      fetchImpl: tracker.impl,
    });

    expect(result).toEqual({ pushed: 1, skipped: 0, failed: 0 });
    expect(tracker.calls).toHaveLength(1);
    expect(tracker.calls[0]?.init?.method).toBe("PATCH");
    expect(tracker.calls[0]?.url).toBe(
      "https://api.github.com/repos/acme/widgets/issues/42",
    );
    expect(
      JSON.parse(String(tracker.calls[0]?.init?.body)),
    ).toEqual({ state: "closed" });

    const [link] = await db.select().from(issueLinks).where(eq(issueLinks.id, linked.link.id));
    expect(link).toMatchObject({ externalStatus: "closed", lastError: null });

    const events = await db
      .select()
      .from(issueSyncEvents)
      .where(eq(issueSyncEvents.connectionId, saved.id));
    const push = events.find((event) => event.action === "issue.status_push");
    expect(push).toMatchObject({
      direction: "outbound",
      outcome: "succeeded",
      fromStatus: "in_progress",
      toStatus: "shipped",
    });
  });

  isolatedTest("a webhook moves the request status once, with an audit trail", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const product = await createProduct(workspace.id);
    const post = await createFeedbackPost({ productId: product.id, status: "open" });
    const { user } = await createMember(workspace.id, { role: "owner" });
    const connectionId = await linearConnection(workspace.id, product.id, user.id);

    await linkExistingIssue({
      workspaceId: workspace.id,
      productId: product.id,
      userId: user.id,
      feedbackPostId: post.id,
      provider: "linear",
      externalId: "linear-issue-1",
    });

    const event = {
      connectionId,
      externalId: "linear-issue-1",
      externalUrl: "https://linear.app/acme/issue/HER-1",
      candidates: ["In Progress"],
      eventName: "Issue.update",
      actorName: "Dana",
      deliveryKey: "delivery-1",
    };

    const first = await processIssueTrackerEvent(event);
    expect(first).toEqual({ applied: true });

    const [updated] = await db.select().from(feedbackPosts).where(eq(feedbackPosts.id, post.id));
    expect(updated?.status).toBe("in_progress");

    const [link] = await db
      .select()
      .from(issueLinks)
      .where(eq(issueLinks.connectionId, connectionId));
    expect(link).toMatchObject({
      externalStatus: "In Progress",
      externalUrl: "https://linear.app/acme/issue/HER-1",
    });

    const duplicate = await processIssueTrackerEvent(event);
    expect(duplicate).toEqual({ applied: false, reason: "duplicate_event" });

    const events = await db
      .select()
      .from(issueSyncEvents)
      .where(
        and(
          eq(issueSyncEvents.connectionId, connectionId),
          eq(issueSyncEvents.direction, "inbound"),
        ),
      );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      direction: "inbound",
      outcome: "succeeded",
      fromStatus: "open",
      toStatus: "in_progress",
      actorName: "Dana",
      externalId: "linear-issue-1",
    });

    const history = await db
      .select()
      .from(feedbackStatusHistory)
      .where(eq(feedbackStatusHistory.feedbackPostId, post.id));
    expect(
      history.some((row) => row.fromStatus === "open" && row.toStatus === "in_progress"),
    ).toBe(true);

    const audits = await db
      .select()
      .from(workspaceAuditEvents)
      .where(
        and(
          eq(workspaceAuditEvents.workspaceId, workspace.id),
          eq(workspaceAuditEvents.action, "integration.issue.status_synced"),
        ),
      );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.metadata).toContain("in_progress");
  });

  isolatedTest("an unmapped external status is recorded as skipped and changes nothing", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const product = await createProduct(workspace.id);
    const post = await createFeedbackPost({ productId: product.id, status: "planned" });
    const { user } = await createMember(workspace.id, { role: "owner" });
    const connectionId = await linearConnection(workspace.id, product.id, user.id);

    await linkExistingIssue({
      workspaceId: workspace.id,
      productId: product.id,
      userId: user.id,
      feedbackPostId: post.id,
      provider: "linear",
      externalId: "linear-issue-2",
    });

    const result = await processIssueTrackerEvent({
      connectionId,
      externalId: "linear-issue-2",
      externalUrl: null,
      candidates: ["Icebox"],
      eventName: "Issue.update",
      actorName: null,
      deliveryKey: "delivery-unmapped",
    });
    expect(result).toEqual({ applied: false, reason: "status_not_mapped" });

    const [unchanged] = await db.select().from(feedbackPosts).where(eq(feedbackPosts.id, post.id));
    expect(unchanged?.status).toBe("planned");

    const events = await db
      .select()
      .from(issueSyncEvents)
      .where(
        and(
          eq(issueSyncEvents.connectionId, connectionId),
          eq(issueSyncEvents.direction, "inbound"),
        ),
      );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ outcome: "skipped", externalStatus: "Icebox" });
  });

  isolatedTest("a connection cannot reach another product's requests", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const productA = await createProduct(workspace.id);
    const productB = await createProduct(workspace.id);
    const postA = await createFeedbackPost({ productId: productA.id, status: "open" });
    const { user } = await createMember(workspace.id, { role: "owner" });

    await linearConnection(workspace.id, productA.id, user.id);
    const connectionB = await linearConnection(workspace.id, productB.id, user.id);

    await linkExistingIssue({
      workspaceId: workspace.id,
      productId: productA.id,
      userId: user.id,
      feedbackPostId: postA.id,
      provider: "linear",
      externalId: "shared-external-id",
    });

    const result = await processIssueTrackerEvent({
      connectionId: connectionB,
      externalId: "shared-external-id",
      externalUrl: null,
      candidates: ["Done"],
      eventName: "Issue.update",
      actorName: null,
      deliveryKey: "delivery-cross-product",
    });
    expect(result).toEqual({ applied: false, reason: "issue_not_linked" });

    const [post] = await db.select().from(feedbackPosts).where(eq(feedbackPosts.id, postA.id));
    expect(post?.status).toBe("open");

    const linksB = await db
      .select()
      .from(issueLinks)
      .where(eq(issueLinks.connectionId, connectionB));
    expect(linksB).toHaveLength(0);
  });

  isolatedTest("settings never expose tokens or webhook secrets", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const product = await createProduct(workspace.id);
    const { user } = await createMember(workspace.id, { role: "owner" });
    await linearConnection(workspace.id, product.id, user.id);

    const views = await listIssueConnectionsForSettings(product.id);
    const serialized = JSON.stringify(views);
    expect(views).toHaveLength(1);
    expect(serialized).not.toContain("lin_api_secret_value");
    expect(serialized).not.toContain("linear-webhook-secret");
    expect(views[0]?.webhookUrl).toContain("/api/integrations/issues/");
  });
});

describe("CRM sync", () => {
  isolatedTest("caches read-only company, contact and deal totals for one tenant", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const product = await createProduct(workspace.id);
    const customer = await createCustomer(workspace.id, { email: "dana@acme.test" });
    const post = await createFeedbackPost({
      productId: product.id,
      authorCustomerId: customer.id,
    });

    const [company] = await db
      .insert(customerCompanies)
      .values({
        workspaceId: workspace.id,
        name: "Acme",
        domain: "acme.test",
        domainNormalized: "acme.test",
        // A stale cache is replaced by provider truth, never trusted as input.
        crmContactCount: 99,
        crmOpenDealCount: 99,
        crmOpenDealValueCents: 99_999,
      })
      .returning();
    await db.insert(customerCompanyMemberships).values({
      workspaceId: workspace.id,
      customerId: customer.id,
      companyId: company!.id,
    });

    // A same-domain company in another workspace must not be touched.
    const other = await createWorkspace({ plan: "pro" });
    const [otherCompany] = await db
      .insert(customerCompanies)
      .values({
        workspaceId: other.id,
        name: "Acme elsewhere",
        domain: "acme.test",
        domainNormalized: "acme.test",
      })
      .returning();

    const { user } = await createMember(workspace.id, { role: "owner" });
    const saved = await saveCrmConnection({
      workspaceId: workspace.id,
      userId: user.id,
      provider: "hubspot",
      name: "HubSpot",
      apiToken: "hubspot-read-token",
    });
    if (!saved.ok) throw new Error(saved.error);

    const crm = fakeFetch((url) => {
      if (url.endsWith("/crm/v3/objects/companies/search")) {
        return { body: { results: [{ id: "9001" }] } };
      }
      if (url.includes("/crm/v3/objects/companies/9001?")) {
        return {
          body: {
            id: "9001",
            properties: { name: "Acme Inc", domain: "acme.test", annualrevenue: "12345" },
            associations: {
              contacts: { results: [{ id: "c1" }, { id: "c2" }] },
              deals: { results: [{ id: "d1" }, { id: "d2" }] },
            },
          },
        };
      }
      if (url.endsWith("/crm/v3/objects/contacts/batch/read")) {
        return {
          body: {
            results: [
              { id: "c1", properties: { email: "dana@acme.test", lifecyclestage: "lead" } },
              {
                id: "c2",
                properties: { email: "other@acme.test", lifecyclestage: "opportunity" },
              },
            ],
          },
        };
      }
      if (url.endsWith("/crm/v3/objects/deals/batch/read")) {
        return {
          body: {
            results: [
              { id: "d1", properties: { amount: "2500", hs_is_closed: "false" } },
              { id: "d2", properties: { amount: "900", hs_is_closed: "true" } },
            ],
          },
        };
      }
      return { status: 404, body: { message: "not found" } };
    });

    const result = await syncCrmConnection(saved.id, crm.impl);
    expect(result).toMatchObject({ processed: 1, failed: 0, matched: 1 });

    const [refreshed] = await db
      .select()
      .from(customerCompanies)
      .where(eq(customerCompanies.id, company!.id));
    expect(refreshed).toMatchObject({
      crmProvider: "hubspot",
      crmExternalId: "9001",
      crmContactCount: 2,
      crmOpenDealCount: 1,
      crmOpenDealValueCents: 250_000,
      crmAnnualRevenueCents: 1_234_500,
      crmSyncError: null,
    });
    expect(refreshed?.crmSyncedAt).toBeInstanceOf(Date);

    const [contact] = await db.select().from(customers).where(eq(customers.id, customer.id));
    expect(contact).toMatchObject({
      crmProvider: "hubspot",
      crmExternalId: "c1",
      crmCompanyExternalId: "9001",
      crmLifecycleStage: "lead",
    });

    const [untouched] = await db
      .select()
      .from(customerCompanies)
      .where(eq(customerCompanies.id, otherCompany!.id));
    expect(untouched?.crmExternalId).toBeNull();
    expect(untouched?.crmContactCount).toBeNull();

    const view = await getFeedbackIntegrationView({
      workspaceId: workspace.id,
      productId: product.id,
      feedbackPostId: post.id,
    });
    expect(view.crm).toMatchObject({
      provider: "hubspot",
      // The workspace's own company name is shown; CRM values are only cached.
      companyName: "Acme",
      contactCount: 2,
      openDealCount: 1,
      openDealValueCents: 250_000,
    });
  });

  isolatedTest("a sync job is enqueued once per dedupe key", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const { user } = await createMember(workspace.id, { role: "owner" });
    const saved = await saveCrmConnection({
      workspaceId: workspace.id,
      userId: user.id,
      provider: "salesforce",
      name: "Salesforce",
      apiToken: "salesforce-read-token",
      instanceUrl: "https://acme.my.salesforce.com",
    });
    if (!saved.ok) throw new Error(saved.error);

    const dedupeKey = `crm-sync:${saved.id}:manual:2026-11-07T10`;
    await enqueueCrmConnectionSync({ connectionId: saved.id, dedupeKey });
    await enqueueCrmConnectionSync({ connectionId: saved.id, dedupeKey });

    const queued = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.type, "sync_crm_connection"), eq(jobs.dedupeKey, dedupeKey)));
    expect(queued).toHaveLength(1);
    expect(queued[0]?.payload).toEqual({ connectionId: saved.id });
  });

  isolatedTest("disconnecting a CRM stops the job from writing cached totals", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const { user } = await createMember(workspace.id, { role: "owner" });
    const saved = await saveCrmConnection({
      workspaceId: workspace.id,
      userId: user.id,
      provider: "hubspot",
      name: "HubSpot",
      apiToken: "hubspot-read-token",
    });
    if (!saved.ok) throw new Error(saved.error);

    await db
      .update(crmConnections)
      .set({ active: false })
      .where(eq(crmConnections.id, saved.id));

    const crm = fakeFetch(() => ({ body: { results: [] } }));
    const result = await syncCrmConnection(saved.id, crm.impl);
    expect(result).toMatchObject({ processed: 0, failed: 0, matched: 0 });
    expect(crm.calls).toHaveLength(0);
  });
});
