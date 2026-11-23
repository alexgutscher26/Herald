import { createHmac } from "node:crypto";

import { describe, expect, test } from "bun:test";

import {
  CrmProviderError,
  fetchCrmCompany,
} from "@/features/integrations/crm-providers";
import {
  IssueProviderError,
  createIssueInTracker,
  defaultStatusMap,
  normalizeIssueConfig,
  normalizeStatusMap,
  parseIssueWebhook,
  statusForCandidates,
  updateIssueStatusInTracker,
  verifyIssueWebhookSignature,
} from "@/features/integrations/issue-providers";

/**
 * Unit coverage for the pure provider contracts.
 *
 * Signatures are computed with the documented raw-body HMAC so a regression in
 * header names or encoding is caught here rather than against a live tracker.
 */

type Captured = { url: string; init: RequestInit | undefined };

function fakeFetch(
  handler: (url: string, init: RequestInit | undefined) => { status?: number; body: unknown },
): { impl: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
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

function bodyOf(init: RequestInit | undefined): string {
  return typeof init?.body === "string" ? init.body : "";
}

function headerOf(init: RequestInit | undefined, name: string): string {
  const headers = init?.headers as Record<string, string> | undefined;
  return headers?.[name] ?? "";
}

function sign(secret: string, raw: string): string {
  return createHmac("sha256", secret).update(raw).digest("hex");
}

describe("issue webhook signatures", () => {
  const raw = JSON.stringify({ type: "Issue", action: "update" });

  test("Linear signs the raw body with Linear-Signature", () => {
    expect(
      verifyIssueWebhookSignature({
        provider: "linear",
        secret: "linear-secret",
        rawBody: raw,
        headers: { "linear-signature": sign("linear-secret", raw) },
      }),
    ).toBe(true);
    expect(
      verifyIssueWebhookSignature({
        provider: "linear",
        secret: "linear-secret",
        rawBody: `${raw} `,
        headers: { "linear-signature": sign("linear-secret", raw) },
      }),
    ).toBe(false);
    expect(
      verifyIssueWebhookSignature({
        provider: "linear",
        secret: "wrong-secret",
        rawBody: raw,
        headers: { "linear-signature": sign("linear-secret", raw) },
      }),
    ).toBe(false);
  });

  test("GitHub accepts the sha256= prefixed digest and requires a secret", () => {
    expect(
      verifyIssueWebhookSignature({
        provider: "github",
        secret: "github-secret",
        rawBody: raw,
        headers: { "x-hub-signature-256": `sha256=${sign("github-secret", raw)}` },
      }),
    ).toBe(true);
    expect(
      verifyIssueWebhookSignature({
        provider: "github",
        secret: null,
        rawBody: raw,
        headers: { "x-hub-signature-256": `sha256=${sign("github-secret", raw)}` },
      }),
    ).toBe(false);
  });

  test("ClickUp uses the X-Signature header", () => {
    expect(
      verifyIssueWebhookSignature({
        provider: "clickup",
        secret: "clickup-secret",
        rawBody: raw,
        headers: { "x-signature": sign("clickup-secret", raw) },
      }),
    ).toBe(true);
    expect(
      verifyIssueWebhookSignature({
        provider: "clickup",
        secret: "clickup-secret",
        rawBody: raw,
        headers: { "x-signature": "0".repeat(64) },
      }),
    ).toBe(false);
  });

  test("Jira and Azure DevOps rely on the unguessable URL token", () => {
    for (const provider of ["jira", "azure_devops"] as const) {
      expect(
        verifyIssueWebhookSignature({ provider, secret: null, rawBody: raw, headers: {} }),
      ).toBe(true);
    }
  });
});

describe("issue webhook payloads", () => {
  test("Linear Issue webhooks carry the state name and delivery id", () => {
    const event = parseIssueWebhook(
      "linear",
      {
        type: "Issue",
        action: "update",
        url: "https://linear.app/acme/issue/HER-4",
        actor: { name: "Dana" },
        webhookTimestamp: 1_700_000_000_000,
        data: {
          id: "d3d3d3d3-0000-4000-8000-000000000001",
          identifier: "HER-4",
          state: { name: "In Progress" },
        },
      },
      { "linear-delivery": "delivery-1" },
    );

    expect(event).toMatchObject({
      externalId: "d3d3d3d3-0000-4000-8000-000000000001",
      externalUrl: "https://linear.app/acme/issue/HER-4",
      candidates: ["In Progress", "HER-4"],
      eventName: "Issue.update",
      actorName: "Dana",
      deliveryKey: "delivery-1",
    });
    expect(parseIssueWebhook("linear", { type: "Comment" }, {})).toBeNull();
  });

  test("Jira issue events read fields.status.name", () => {
    const event = parseIssueWebhook(
      "jira",
      {
        webhookEvent: "jira:issue_updated",
        timestamp: 1_700_000_000_000,
        user: { displayName: "Dana" },
        issue: { key: "ENG-7", fields: { status: { name: "In Review" } } },
      },
      {},
    );

    expect(event).toMatchObject({
      externalId: "ENG-7",
      candidates: ["In Review"],
      eventName: "jira:issue_updated",
      actorName: "Dana",
    });
    expect(event?.deliveryKey).toContain("ENG-7");
    expect(parseIssueWebhook("jira", { webhookEvent: "jira:version_released" }, {})).toBeNull();
  });

  test("GitHub labels are considered before the open/closed state", () => {
    const event = parseIssueWebhook(
      "github",
      {
        action: "labeled",
        issue: {
          number: 12,
          html_url: "https://github.com/acme/widgets/issues/12",
          state: "open",
          labels: [{ name: "In Progress" }, "planned"],
        },
        sender: { login: "dana" },
      },
      { "x-github-delivery": "gh-delivery" },
    );

    expect(event).toMatchObject({
      externalId: "12",
      candidates: ["In Progress", "planned", "open"],
      eventName: "issues.labeled",
      actorName: "dana",
      deliveryKey: "gh-delivery",
    });
  });

  test("ClickUp reads the latest status history entry", () => {
    const event = parseIssueWebhook(
      "clickup",
      {
        event: "taskStatusUpdated",
        webhook_id: "wh-1",
        task_id: "task-9",
        task: { status: { status: "in progress" }, url: "https://app.clickup.com/t/task-9" },
        history_items: [
          { id: "history-1", after: { status: "to do" }, user: { username: "dana" } },
          { id: "history-2", after: { status: "review" }, user: { username: "sam" } },
        ],
      },
      {},
    );

    expect(event).toMatchObject({
      externalId: "task-9",
      externalUrl: "https://app.clickup.com/t/task-9",
      candidates: ["review"],
      eventName: "taskStatusUpdated",
      actorName: "sam",
      deliveryKey: "wh-1:history-2",
    });
  });

  test("Azure DevOps work-item events read System.State", () => {
    const event = parseIssueWebhook(
      "azure_devops",
      {
        eventType: "workitem.updated",
        notificationId: 42,
        resource: {
          id: 77,
          fields: {
            "System.State": "Active",
            "System.ChangedBy": { displayName: "Dana" },
          },
          _links: { html: { href: "https://dev.azure.com/acme/Web/_workitems/edit/77" } },
        },
      },
      {},
    );

    expect(event).toMatchObject({
      externalId: "77",
      externalUrl: "https://dev.azure.com/acme/Web/_workitems/edit/77",
      candidates: ["Active"],
      eventName: "workitem.updated",
      actorName: "Dana",
      deliveryKey: "42",
    });
  });
});

describe("status mapping", () => {
  test("maps case-insensitively and stops at the first known candidate", () => {
    const map = { "in progress": "in_progress", planned: "planned", done: "shipped" } as const;

    expect(statusForCandidates(map, ["In Progress", "planned"])).toBe("in_progress");
    expect(statusForCandidates(map, ["Icebox", "Planned"])).toBe("planned");
    expect(statusForCandidates(map, ["Icebox"])).toBeNull();
  });

  test("normalization lowercases keys and rejects unknown Herald statuses", () => {
    const ok = normalizeStatusMap({ "In Progress": "in_progress", DONE: "shipped" });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.map).toEqual({ "in progress": "in_progress", done: "shipped" });

    expect(normalizeStatusMap({ done: "finished" }).ok).toBe(false);
    expect(normalizeStatusMap({ "": "open" }).ok).toBe(false);
  });

  test("every provider ships a default map with known statuses", () => {
    for (const provider of ["linear", "jira", "github", "clickup", "azure_devops"] as const) {
      const map = defaultStatusMap(provider);
      expect(Object.keys(map).length).toBeGreaterThan(0);
      for (const status of Object.values(map)) {
        expect(["open", "under_review", "planned", "in_progress", "shipped", "closed"]).toContain(
          status,
        );
      }
    }
  });
});

describe("provider configuration", () => {
  test("requires the fields each provider needs", () => {
    expect(normalizeIssueConfig("linear", {}).ok).toBe(false);
    expect(normalizeIssueConfig("linear", { teamId: "team-1" }).ok).toBe(true);

    expect(normalizeIssueConfig("jira", { baseUrl: "https://acme.atlassian.net" }).ok).toBe(false);
    expect(
      normalizeIssueConfig("jira", {
        baseUrl: "https://acme.atlassian.net",
        email: "bot@acme.test",
        projectKey: "ENG",
        issueType: "Bug",
      }).ok,
    ).toBe(true);
    expect(
      normalizeIssueConfig("jira", {
        baseUrl: "https://acme.atlassian.net/jira",
        email: "bot@acme.test",
        projectKey: "ENG",
        issueType: "Bug",
      }).ok,
    ).toBe(false);
    expect(
      normalizeIssueConfig("jira", {
        baseUrl: "http://acme.atlassian.net",
        email: "bot@acme.test",
        projectKey: "ENG",
        issueType: "Bug",
      }).ok,
    ).toBe(false);

    expect(normalizeIssueConfig("github", { owner: "acme", repo: "widgets" }).ok).toBe(true);
    expect(normalizeIssueConfig("github", { owner: "ac me", repo: "widgets" }).ok).toBe(false);
    expect(normalizeIssueConfig("clickup", { listId: "list-1" }).ok).toBe(true);
    expect(
      normalizeIssueConfig("azure_devops", {
        baseUrl: "https://dev.azure.com",
        organization: "acme",
        project: "Web",
        workItemType: "Bug",
      }).ok,
    ).toBe(true);
  });
});

describe("outbound issue creation", () => {
  test("Linear sends issueCreate and returns the identifier and state", async () => {
    const { impl, calls } = fakeFetch(() => ({
      body: {
        data: {
          issueCreate: {
            success: true,
            issue: {
              id: "issue-uuid",
              identifier: "HER-12",
              url: "https://linear.app/acme/issue/HER-12",
              state: { name: "Triage" },
            },
          },
        },
      },
    }));

    const created = await createIssueInTracker({
      provider: "linear",
      config: { teamId: "team-1" },
      apiToken: "lin_api_key",
      title: "Dark mode",
      body: "Please add dark mode.",
      requestUrl: "https://feedback.test/p/acme/widgets/requests/abc",
      fetchImpl: impl,
    });

    expect(created).toEqual({
      externalId: "issue-uuid",
      externalKey: "HER-12",
      externalUrl: "https://linear.app/acme/issue/HER-12",
      externalStatus: "Triage",
    });
    expect(calls[0]?.url).toBe("https://api.linear.app/graphql");
    expect(headerOf(calls[0]?.init, "authorization")).toBe("lin_api_key");
    const sent = JSON.parse(bodyOf(calls[0]?.init)) as {
      variables: { input: { teamId: string; title: string; description: string } };
    };
    expect(sent.variables.input.teamId).toBe("team-1");
    expect(sent.variables.input.title).toBe("Dark mode");
    expect(sent.variables.input.description).toContain("feedback.test");
  });

  test("Jira uses Basic auth and the browse URL", async () => {
    const { impl, calls } = fakeFetch(() => ({ body: { id: "10001", key: "ENG-7" } }));

    const created = await createIssueInTracker({
      provider: "jira",
      config: {
        baseUrl: "https://acme.atlassian.net",
        email: "bot@acme.test",
        projectKey: "ENG",
        issueType: "Bug",
      },
      apiToken: "jira-token",
      title: "Dark mode",
      body: "Please add dark mode.",
      requestUrl: "https://feedback.test/p/acme/widgets/requests/abc",
      fetchImpl: impl,
    });

    expect(created).toMatchObject({
      externalId: "ENG-7",
      externalKey: "ENG-7",
      externalUrl: "https://acme.atlassian.net/browse/ENG-7",
    });
    expect(calls[0]?.url).toBe("https://acme.atlassian.net/rest/api/3/issue");
    const auth = headerOf(calls[0]?.init, "authorization").replace(/^Basic /, "");
    expect(Buffer.from(auth, "base64").toString("utf8")).toBe("bot@acme.test:jira-token");
  });

  test("GitHub posts to the repository issues endpoint", async () => {
    const { impl, calls } = fakeFetch(() => ({
      body: {
        number: 12,
        html_url: "https://github.com/acme/widgets/issues/12",
        state: "open",
      },
    }));

    const created = await createIssueInTracker({
      provider: "github",
      config: { owner: "acme", repo: "widgets" },
      apiToken: "ghp_token",
      title: "Dark mode",
      body: "Please add dark mode.",
      requestUrl: "https://feedback.test/p/acme/widgets/requests/abc",
      fetchImpl: impl,
    });

    expect(created).toMatchObject({
      externalId: "12",
      externalKey: "#12",
      externalUrl: "https://github.com/acme/widgets/issues/12",
      externalStatus: "open",
    });
    expect(calls[0]?.url).toBe("https://api.github.com/repos/acme/widgets/issues");
    expect(headerOf(calls[0]?.init, "authorization")).toBe("Bearer ghp_token");
  });

  test("ClickUp posts to the configured list", async () => {
    const { impl, calls } = fakeFetch(() => ({
      body: {
        id: "abc123",
        url: "https://app.clickup.com/t/abc123",
        status: { status: "to do" },
      },
    }));

    const created = await createIssueInTracker({
      provider: "clickup",
      config: { listId: "list-9" },
      apiToken: "pk_clickup",
      title: "Dark mode",
      body: "Please add dark mode.",
      requestUrl: "https://feedback.test/p/acme/widgets/requests/abc",
      fetchImpl: impl,
    });

    expect(created).toMatchObject({
      externalId: "abc123",
      externalStatus: "to do",
    });
    expect(calls[0]?.url).toBe("https://api.clickup.com/api/v2/list/list-9/task");
  });

  test("Azure DevOps sends a JSON patch with the work item type", async () => {
    const { impl, calls } = fakeFetch(() => ({
      body: {
        id: 77,
        fields: { "System.State": "New" },
        _links: { html: { href: "https://dev.azure.com/acme/Web/_workitems/edit/77" } },
      },
    }));

    const created = await createIssueInTracker({
      provider: "azure_devops",
      config: {
        baseUrl: "https://dev.azure.com",
        organization: "acme",
        project: "Web",
        workItemType: "Bug",
      },
      apiToken: "azure-token",
      title: "Dark mode",
      body: "Please add dark mode.",
      requestUrl: "https://feedback.test/p/acme/widgets/requests/abc",
      fetchImpl: impl,
    });

    expect(created).toMatchObject({
      externalId: "77",
      externalKey: "77",
      externalUrl: "https://dev.azure.com/acme/Web/_workitems/edit/77",
      externalStatus: "New",
    });
    expect(calls[0]?.url).toContain("/acme/Web/_apis/wit/workitems/$Bug?api-version=7.1");
    const patch = JSON.parse(bodyOf(calls[0]?.init)) as {
      op: string;
      path: string;
      value: string;
    }[];
    expect(patch[0]).toEqual({ op: "add", path: "/fields/System.Title", value: "Dark mode" });
    const auth = headerOf(calls[0]?.init, "authorization").replace(/^Basic /, "");
    expect(Buffer.from(auth, "base64").toString("utf8")).toBe(":azure-token");
  });

  test("classifies provider failures for retry decisions", async () => {
    const { impl } = fakeFetch(() => ({ status: 503, body: { message: "down" } }));

    const failure = createIssueInTracker({
      provider: "github",
      config: { owner: "acme", repo: "widgets" },
      apiToken: "ghp_token",
      title: "Dark mode",
      body: "Body",
      requestUrl: "https://feedback.test/p/acme/widgets/requests/abc",
      fetchImpl: impl,
    });

    await expect(failure).rejects.toBeInstanceOf(IssueProviderError);
    await failure.catch((error: IssueProviderError) => {
      expect(error.status).toBe(503);
      expect(error.retryable).toBe(true);
    });
  });
});

describe("CRM adapters", () => {
  test("HubSpot resolves a company by domain and reads contacts and open deals", async () => {
    const { impl } = fakeFetch((url) => {
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
              {
                id: "c1",
                properties: { email: "dana@acme.test", lifecyclestage: "lead" },
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

    const snapshot = await fetchCrmCompany({
      provider: "hubspot",
      token: "hubspot-token",
      domain: "acme.test",
      externalId: null,
      fetchImpl: impl,
    });

    expect(snapshot).toMatchObject({
      externalId: "9001",
      name: "Acme Inc",
      domain: "acme.test",
      contactCount: 2,
      openDealCount: 1,
      openDealValueCents: 250_000,
      annualRevenueCents: 1_234_500,
    });
    expect(snapshot?.contacts).toEqual([
      { externalId: "c1", email: "dana@acme.test", lifecycleStage: "lead" },
    ]);
  });

  test("Salesforce applies SOQL counts and the open opportunity total", async () => {
    const { impl } = fakeFetch((url) => {
      const query = new URL(url).searchParams.get("q") ?? "";
      if (query.startsWith("SELECT Id, Name")) {
        return {
          body: {
            records: [
              {
                Id: "001",
                Name: "Acme",
                Website: "acme.test",
                AnnualRevenue: 50_000,
              },
            ],
          },
        };
      }
      if (query.startsWith("SELECT COUNT() FROM Contact")) {
        return { body: { totalSize: 3 } };
      }
      if (query.startsWith("SELECT COUNT(Id), SUM(Amount)")) {
        return { body: { records: [{ expr0: 2, expr1: 12345.67 }] } };
      }
      if (query.startsWith("SELECT Id, Email FROM Contact")) {
        return { body: { records: [{ Id: "003", Email: "dana@acme.test" }] } };
      }
      return { status: 400, body: { message: "unexpected query" } };
    });

    const snapshot = await fetchCrmCompany({
      provider: "salesforce",
      token: "sf-token",
      instanceUrl: "https://acme.my.salesforce.com",
      domain: "acme.test",
      externalId: null,
      fetchImpl: impl,
    });

    expect(snapshot).toMatchObject({
      externalId: "001",
      name: "Acme",
      contactCount: 3,
      openDealCount: 2,
      openDealValueCents: 1_234_567,
      annualRevenueCents: 5_000_000,
    });
    expect(snapshot?.contacts).toEqual([
      { externalId: "003", email: "dana@acme.test", lifecycleStage: null },
    ]);
  });

  test("Salesforce without an instance URL fails before any request", async () => {
    const failure = fetchCrmCompany({
      provider: "salesforce",
      token: "sf-token",
      instanceUrl: null,
      domain: "acme.test",
      externalId: null,
    });
    await expect(failure).rejects.toBeInstanceOf(CrmProviderError);
  });
});

describe("outbound issue status push", () => {
  const base = {
    config: { teamId: "team-1" },
    apiToken: "tracker-token",
    externalId: "42",
  };

  test("GitHub closes the issue only for a terminal Herald status", async () => {
    const { impl, calls } = fakeFetch(() => ({ body: { state: "closed" } }));
    const result = await updateIssueStatusInTracker({
      ...base,
      provider: "github",
      config: { owner: "acme", repo: "app" },
      externalStatus: "done",
      fetchImpl: impl,
    });

    expect(result.externalStatus).toBe("closed");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(calls[0]?.url).toBe("https://api.github.com/repos/acme/app/issues/42");
    expect(JSON.parse(bodyOf(calls[0]?.init))).toEqual({ state: "closed" });
    expect(headerOf(calls[0]?.init, "authorization")).toBe("Bearer tracker-token");
  });

  test("GitHub reopens for a non-terminal status", async () => {
    const { impl, calls } = fakeFetch(() => ({ body: { state: "open" } }));
    await updateIssueStatusInTracker({
      ...base,
      provider: "github",
      config: { owner: "acme", repo: "app" },
      externalStatus: "In progress",
      fetchImpl: impl,
    });
    expect(JSON.parse(bodyOf(calls[0]?.init))).toEqual({ state: "open" });
  });

  test("Jira resolves the transition whose destination matches the target", async () => {
    const { impl, calls } = fakeFetch((url, init) => {
      if (init?.method === "GET") {
        return {
          body: {
            transitions: [
              { id: "11", name: "In Progress", to: { name: "In Progress" } },
              { id: "31", name: "Done", to: { name: "Done" } },
            ],
          },
        };
      }
      expect(url).toContain("/transitions");
      return { body: {} };
    });

    const result = await updateIssueStatusInTracker({
      ...base,
      provider: "jira",
      config: {
        baseUrl: "https://acme.atlassian.net",
        email: "ops@acme.test",
        projectKey: "APP",
      },
      externalId: "APP-7",
      externalStatus: "done",
      fetchImpl: impl,
    });

    expect(result.externalStatus).toBe("Done");
    expect(calls).toHaveLength(2);
    expect(JSON.parse(bodyOf(calls[1]?.init))).toEqual({ transition: { id: "31" } });
  });

  test("Jira fails with a safe message when no transition reaches the target", async () => {
    const { impl } = fakeFetch(() => ({ body: { transitions: [] } }));
    await expect(
      updateIssueStatusInTracker({
        ...base,
        provider: "jira",
        config: {
          baseUrl: "https://acme.atlassian.net",
          email: "ops@acme.test",
          projectKey: "APP",
        },
        externalStatus: "done",
        fetchImpl: impl,
      }),
    ).rejects.toBeInstanceOf(IssueProviderError);
  });

  test("Linear resolves a state id before mutating the issue", async () => {
    const { impl, calls } = fakeFetch((_url, init) => {
      const body = JSON.parse(bodyOf(init)) as { query: string };
      if (body.query.includes("TeamStates")) {
        return {
          body: {
            data: { team: { states: { nodes: [{ id: "state-9", name: "Done" }] } } },
          },
        };
      }
      return {
        body: {
          data: { issueUpdate: { success: true, issue: { state: { name: "Done" } } } },
        },
      };
    });

    const result = await updateIssueStatusInTracker({
      ...base,
      provider: "linear",
      externalId: "issue-uuid",
      externalStatus: "Done",
      fetchImpl: impl,
    });

    expect(result.externalStatus).toBe("Done");
    expect(calls).toHaveLength(2);
    const mutation = JSON.parse(bodyOf(calls[1]?.init)) as {
      query: string;
      variables: { id: string; stateId: string };
    };
    expect(mutation.query).toContain("issueUpdate");
    expect(mutation.variables).toEqual({ id: "issue-uuid", stateId: "state-9" });
  });
});
