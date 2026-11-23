import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

/**
 * Provider contracts for issue-tracker sync.
 *
 * This module is pure: it validates non-secret configuration, maps provider
 * status names to Herald statuses, parses webhook payloads and performs the
 * outbound create call. Database and authorization live in the service.
 */

export const ISSUE_PROVIDERS = [
  "linear",
  "jira",
  "github",
  "clickup",
  "azure_devops",
] as const;

export type IssueProvider = (typeof ISSUE_PROVIDERS)[number];

export const ISSUE_PROVIDER_LABELS: Record<IssueProvider, string> = {
  linear: "Linear",
  jira: "Jira",
  github: "GitHub",
  clickup: "ClickUp",
  azure_devops: "Azure DevOps",
};

export const HERALD_STATUSES = [
  "open",
  "under_review",
  "planned",
  "in_progress",
  "shipped",
  "closed",
] as const;

export type HeraldStatus = (typeof HERALD_STATUSES)[number];

export type IssueProviderConfig = {
  teamId?: string | undefined;
  baseUrl?: string | undefined;
  email?: string | undefined;
  projectKey?: string | undefined;
  issueType?: string | undefined;
  owner?: string | undefined;
  repo?: string | undefined;
  listId?: string | undefined;
  organization?: string | undefined;
  project?: string | undefined;
  workItemType?: string | undefined;
  areaPath?: string | undefined;
};

const configSchema = z
  .object({
    teamId: z.string().trim().max(200).optional(),
    baseUrl: z.string().trim().max(2_000).optional(),
    email: z.string().trim().max(320).optional(),
    projectKey: z.string().trim().max(100).optional(),
    issueType: z.string().trim().max(100).optional(),
    owner: z.string().trim().max(200).optional(),
    repo: z.string().trim().max(200).optional(),
    listId: z.string().trim().max(200).optional(),
    organization: z.string().trim().max(200).optional(),
    project: z.string().trim().max(200).optional(),
    workItemType: z.string().trim().max(100).optional(),
    areaPath: z.string().trim().max(500).optional(),
  })
  .strict();

const statusMapSchema = z
  .record(z.string().trim().min(1).max(100), z.enum(HERALD_STATUSES))
  .refine((value) => Object.keys(value).length <= 100, {
    message: "Map at most 100 statuses.",
  });

export function isIssueProvider(value: unknown): value is IssueProvider {
  return typeof value === "string" && (ISSUE_PROVIDERS as readonly string[]).includes(value);
}

function httpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

export function providerConfigDefaults(): IssueProviderConfig {
  return {
    baseUrl: "https://api.linear.app",
  };
}

export function defaultStatusMap(provider: IssueProvider): Record<string, HeraldStatus> {
  switch (provider) {
    case "linear":
      return {
        backlog: "open",
        triage: "under_review",
        todo: "planned",
        "to do": "planned",
        unstarted: "planned",
        "in progress": "in_progress",
        started: "in_progress",
        done: "shipped",
        completed: "shipped",
        canceled: "closed",
        cancelled: "closed",
      };
    case "jira":
      return {
        "to do": "open",
        "in progress": "in_progress",
        "in review": "under_review",
        done: "shipped",
        closed: "closed",
      };
    case "github":
      return {
        open: "open",
        closed: "shipped",
        planned: "planned",
        "in progress": "in_progress",
        done: "shipped",
      };
    case "clickup":
      return {
        "to do": "open",
        "in progress": "in_progress",
        review: "under_review",
        complete: "shipped",
        closed: "closed",
      };
    case "azure_devops":
      return {
        new: "open",
        approved: "under_review",
        committed: "planned",
        active: "in_progress",
        resolved: "shipped",
        closed: "closed",
        removed: "closed",
      };
  }
}

export function normalizeIssueConfig(
  provider: IssueProvider,
  raw: Record<string, unknown>,
): { ok: true; config: IssueProviderConfig } | { ok: false; error: string } {
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid configuration." };
  }
  const config = parsed.data;

  if (provider === "jira" || provider === "azure_devops") {
    if (!config.baseUrl || !httpsUrl(config.baseUrl)) {
      return { ok: false, error: "Use an https origin without a path." };
    }
  }
  if (provider === "jira") {
    if (!config.email) return { ok: false, error: "Jira needs the API user's email." };
    if (!config.projectKey) return { ok: false, error: "Jira needs a project key." };
    if (!config.issueType) return { ok: false, error: "Jira needs an issue type." };
  }
  if (provider === "linear" && !config.teamId) {
    return { ok: false, error: "Linear needs a team id." };
  }
  if (provider === "github") {
    if (!config.owner || !config.repo) {
      return { ok: false, error: "GitHub needs an owner and repository." };
    }
    if (!/^[A-Za-z0-9_.-]+$/.test(config.owner) || !/^[A-Za-z0-9_.-]+$/.test(config.repo)) {
      return { ok: false, error: "The GitHub owner or repository contains invalid characters." };
    }
  }
  if (provider === "clickup" && !config.listId) {
    return { ok: false, error: "ClickUp needs a list id." };
  }
  if (provider === "azure_devops") {
    if (!config.organization || !config.project) {
      return { ok: false, error: "Azure DevOps needs an organization and project." };
    }
    if (!config.workItemType) return { ok: false, error: "Azure DevOps needs a work item type." };
  }

  return { ok: true, config };
}

export function normalizeStatusMap(
  raw: unknown,
): { ok: true; map: Record<string, HeraldStatus> } | { ok: false; error: string } {
  const parsed = statusMapSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "The status map is invalid.",
    };
  }
  return {
    ok: true,
    map: Object.fromEntries(
      Object.entries(parsed.data).map(([key, value]) => [key.trim().toLowerCase(), value]),
    ),
  };
}

/**
 * Pick the first external status or label with a configured mapping. GitHub
 * sends labels before the issue state, which lets a board column win over the
 * generic open/closed state.
 */
export function statusForCandidates(
  statusMap: Record<string, string>,
  candidates: readonly string[],
): HeraldStatus | null {
  for (const candidate of candidates) {
    const mapped = statusMap[candidate.trim().toLowerCase()];
    if (mapped && (HERALD_STATUSES as readonly string[]).includes(mapped)) {
      return mapped as HeraldStatus;
    }
  }
  return null;
}

export type IssueWebhookEvent = {
  externalId: string;
  externalUrl: string | null;
  candidates: string[];
  eventName: string;
  actorName: string | null;
  deliveryKey: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown, max = 2_000): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, max) : null;
}

function header(headers: Record<string, string>, name: string): string | null {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return null;
}

export function verifyIssueWebhookSignature(input: {
  provider: IssueProvider;
  secret: string | null;
  rawBody: string;
  headers: Record<string, string>;
}): boolean {
  if (input.provider === "jira" || input.provider === "azure_devops") {
    // Neither admin webhook surface reliably signs deliveries. The connection's
    // unguessable URL token is the authenticator for these two providers.
    return true;
  }
  if (!input.secret) return false;

  const expected = createHmac("sha256", input.secret).update(input.rawBody).digest("hex");
  const provided =
    input.provider === "github"
      ? header(input.headers, "x-hub-signature-256")?.replace(/^sha256=/, "") ?? ""
      : input.provider === "linear"
        ? header(input.headers, "linear-signature") ?? ""
        : header(input.headers, "x-signature") ?? "";

  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function parseIssueWebhook(
  provider: IssueProvider,
  payload: unknown,
  headers: Record<string, string>,
): IssueWebhookEvent | null {
  const root = record(payload);
  if (!root) return null;

  if (provider === "linear") {
    if (root.type !== "Issue") return null;
    const data = record(root.data);
    if (!data) return null;
    const state = record(data.state);
    const id = stringValue(data.id, 200);
    if (!id) return null;
    const externalUrl = stringValue(root.url) ?? stringValue(data.url);
    const actor = record(root.actor);
    const timestamp = stringValue(String(root.webhookTimestamp ?? ""));
    return {
      externalId: id,
      externalUrl,
      candidates: [stringValue(state?.name) ?? "", stringValue(data.identifier) ?? ""].filter(
        Boolean,
      ),
      eventName: `Issue.${stringValue(root.action) ?? "update"}`,
      actorName: stringValue(actor?.name),
      deliveryKey:
        header(headers, "linear-delivery") ??
        `linear:${id}:${timestamp ?? "0"}:${stringValue(state?.name) ?? ""}`,
    };
  }

  if (provider === "jira") {
    if (!stringValue(root.webhookEvent)?.startsWith("jira:issue")) return null;
    const issue = record(root.issue);
    const fields = record(issue?.fields);
    const status = record(fields?.status);
    const key = stringValue(issue?.key, 200);
    if (!issue || !key) return null;
    const timestamp = stringValue(String(root.timestamp ?? ""));
    return {
      externalId: key,
      externalUrl: null,
      candidates: [stringValue(status?.name) ?? ""].filter(Boolean),
      eventName: stringValue(root.webhookEvent) ?? "jira:issue_updated",
      actorName: stringValue(record(root.user)?.displayName),
      deliveryKey: `jira:${key}:${timestamp ?? "0"}:${stringValue(status?.name) ?? ""}`,
    };
  }

  if (provider === "github") {
    const issue = record(root.issue);
    if (!issue) return null;
    const number = issue.number;
    if (typeof number !== "number" || !Number.isSafeInteger(number)) return null;
    const labels = Array.isArray(issue.labels)
      ? issue.labels
          .map((label) => (typeof label === "string" ? label : stringValue(record(label)?.name)))
          .filter((label): label is string => Boolean(label))
      : [];
    return {
      externalId: String(number),
      externalUrl: stringValue(issue.html_url),
      candidates: [...labels, stringValue(issue.state) ?? ""].filter(Boolean),
      eventName: `issues.${stringValue(root.action) ?? "updated"}`,
      actorName: stringValue(record(root.sender)?.login),
      deliveryKey:
        header(headers, "x-github-delivery") ??
        `github:${String(number)}:${stringValue(root.action) ?? "updated"}`,
    };
  }

  if (provider === "clickup") {
    const eventName = stringValue(root.event) ?? "";
    if (!["taskStatusUpdated", "taskUpdated", "taskCreated"].includes(eventName)) return null;
    const taskId = stringValue(root.task_id, 200);
    if (!taskId) return null;
    const task = record(root.task);
    const taskStatus = record(task?.status);
    const history = Array.isArray(root.history_items) ? root.history_items : [];
    const latest = record(history[history.length - 1]);
    const after = record(latest?.after);
    const historyId = stringValue(latest?.id);
    const candidates = [
      stringValue(record(after?.status)?.status) ??
        stringValue(after?.status) ??
        stringValue(taskStatus?.status) ??
        "",
    ].filter(Boolean);
    return {
      externalId: taskId,
      externalUrl: stringValue(task?.url),
      candidates,
      eventName,
      actorName: stringValue(record(latest?.user)?.username),
      deliveryKey:
        historyId && stringValue(root.webhook_id)
          ? `${stringValue(root.webhook_id)}:${historyId}`
          : `clickup:${taskId}:${historyId ?? eventName}`,
    };
  }

  const eventType = stringValue(root.eventType) ?? "";
  if (!eventType.startsWith("workitem.")) return null;
  const resource = record(root.resource);
  const id = resource?.id;
  const fields = record(resource?.fields);
  if (typeof id !== "number" || !Number.isSafeInteger(id)) return null;
  const links = record(resource?._links);
  const html = record(links?.html);
  const externalUrl = stringValue(html?.href) ?? stringValue(resource?.url);
  const actor = record(record(resource?.fields)?.["System.ChangedBy"]);
  return {
    externalId: String(id),
    externalUrl,
    candidates: [stringValue(fields?.["System.State"]) ?? ""].filter(Boolean),
    eventName: eventType,
    actorName: stringValue(actor?.displayName) ?? stringValue(actor?.uniqueName),
    deliveryKey:
      stringValue(String(root.notificationId ?? "")) ??
      stringValue(String(root.id ?? "")) ??
      `azure:${id}:${stringValue(fields?.["System.ChangedDate"]) ?? "0"}`,
  };
}

export class IssueProviderError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(message: string, status: number | null = null, retryable = false) {
    super(message);
    this.name = "IssueProviderError";
    this.status = status;
    this.retryable = retryable;
  }
}

export type CreatedIssue = {
  externalId: string;
  externalKey: string;
  externalUrl: string;
  externalStatus: string | null;
};

type CreateIssueInput = {
  provider: IssueProvider;
  config: IssueProviderConfig;
  apiToken: string;
  title: string;
  body: string;
  requestUrl: string;
  fetchImpl?: typeof fetch | undefined;
};

type ProviderCall = Pick<
  CreateIssueInput,
  "provider" | "config" | "apiToken" | "fetchImpl"
>;

async function providerJson<T>(
  input: ProviderCall,
  url: string,
  init: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(url, {
      ...init,
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch {
    throw new IssueProviderError("Could not reach the issue tracker.", null, true);
  }
  const payload = (await response.json().catch(() => null)) as
    | (T & { message?: string; errors?: unknown })
    | null;
  if (!response.ok) {
    const detail =
      typeof payload?.message === "string" ? payload.message.slice(0, 500) : `HTTP ${response.status}`;
    throw new IssueProviderError(
      `The issue tracker rejected the request (${detail}).`,
      response.status,
      response.status === 429 || response.status >= 500,
    );
  }
  if (!payload) throw new IssueProviderError("The issue tracker returned an empty response.", 502, true);
  return payload;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function adfDocument(value: string): Record<string, unknown> {
  const paragraphs = value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .slice(0, 40)
    .map((paragraph) => ({
      type: "paragraph",
      content: [{ type: "text", text: paragraph.slice(0, 2_000) }],
    }));
  return {
    type: "doc",
    version: 1,
    content: paragraphs.length > 0 ? paragraphs : [{ type: "paragraph", content: [] }],
  };
}

export async function createIssueInTracker(input: CreateIssueInput): Promise<CreatedIssue> {
  const title = input.title.trim().slice(0, 250);
  const body = input.body.trim().slice(0, 20_000);

  if (input.provider === "linear") {
    const payload = await providerJson<{
      data?: {
        issueCreate?: {
          success?: boolean;
          issue?: {
            id?: string;
            identifier?: string;
            url?: string;
            state?: { name?: string };
          };
        };
      };
      errors?: { message?: string }[];
    }>(input, "https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        authorization: input.apiToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query:
          "mutation IssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url state { name } } } }",
        variables: {
          input: {
            teamId: input.config.teamId,
            title,
            description: `${body}\n\nHerald request: ${input.requestUrl}`,
          },
        },
      }),
    });
    const issue = payload.data?.issueCreate?.issue;
    if (!payload.data?.issueCreate?.success || !issue?.id) {
      throw new IssueProviderError(
        payload.errors?.[0]?.message ?? "Linear did not create the issue.",
        422,
      );
    }
    return {
      externalId: issue.id,
      externalKey: issue.identifier ?? issue.id,
      externalUrl: issue.url ?? "https://linear.app",
      externalStatus: issue.state?.name ?? null,
    };
  }

  if (input.provider === "jira") {
    const base = input.config.baseUrl!.replace(/\/+$/, "");
    const payload = await providerJson<{ id: string; key: string }>(
      input,
      `${base}/rest/api/3/issue`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(
            `${input.config.email}:${input.apiToken}`,
            "utf8",
          ).toString("base64")}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          fields: {
            project: { key: input.config.projectKey },
            issuetype: { name: input.config.issueType },
            summary: title,
            description: adfDocument(`${body}\n\nHerald request: ${input.requestUrl}`),
          },
        }),
      },
    );
    return {
      externalId: payload.key,
      externalKey: payload.key,
      externalUrl: `${base}/browse/${encodeURIComponent(payload.key)}`,
      externalStatus: null,
    };
  }

  if (input.provider === "github") {
    const payload = await providerJson<{
      number: number;
      html_url: string;
      state: string;
    }>(
      input,
      `https://api.github.com/repos/${encodeURIComponent(input.config.owner!)}/${encodeURIComponent(
        input.config.repo!,
      )}/issues`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.apiToken}`,
          accept: "application/vnd.github+json",
          "content-type": "application/json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "Herald",
        },
        body: JSON.stringify({
          title,
          body: `${body}\n\nHerald request: ${input.requestUrl}`,
        }),
      },
    );
    return {
      externalId: String(payload.number),
      externalKey: `#${payload.number}`,
      externalUrl: payload.html_url,
      externalStatus: payload.state,
    };
  }

  if (input.provider === "clickup") {
    const payload = await providerJson<{
      id: string;
      url?: string;
      status?: { status?: string };
    }>(input, `https://api.clickup.com/api/v2/list/${encodeURIComponent(input.config.listId!)}/task`, {
      method: "POST",
      headers: {
        authorization: input.apiToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: title,
        markdown_description: `${body}\n\nHerald request: ${input.requestUrl}`,
      }),
    });
    return {
      externalId: payload.id,
      externalKey: payload.id,
      externalUrl: payload.url ?? "https://app.clickup.com",
      externalStatus: payload.status?.status ?? null,
    };
  }

  const base = input.config.baseUrl!.replace(/\/+$/, "");
  const workItemType = input.config.workItemType!;
  const payload = await providerJson<{
    id: number;
    fields?: Record<string, unknown>;
    _links?: { html?: { href?: string } };
  }>(
    input,
    `${base}/${encodeURIComponent(input.config.organization!)}/${encodeURIComponent(
      input.config.project!,
    )}/_apis/wit/workitems/$${encodeURIComponent(workItemType)}?api-version=7.1`,
    {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`:${input.apiToken}`, "utf8").toString("base64")}`,
        "content-type": "application/json-patch+json",
        accept: "application/json",
      },
      body: JSON.stringify([
        { op: "add", path: "/fields/System.Title", value: title },
        {
          op: "add",
          path: "/fields/System.Description",
          value: `<p>${escapeHtml(body).replaceAll("\n", "<br />")}</p><p>Herald request: <a href="${escapeHtml(input.requestUrl)}">${escapeHtml(input.requestUrl)}</a></p>`,
        },
        ...(input.config.areaPath
          ? [{ op: "add", path: "/fields/System.AreaPath", value: input.config.areaPath }]
          : []),
      ]),
    },
  );
  return {
    externalId: String(payload.id),
    externalKey: String(payload.id),
    externalUrl:
      payload._links?.html?.href ??
      `${base}/${encodeURIComponent(input.config.organization!)}/${encodeURIComponent(
        input.config.project!,
      )}/_workitems/edit/${payload.id}`,
    externalStatus:
      typeof payload.fields?.["System.State"] === "string"
        ? payload.fields["System.State"]
        : null,
  };
}

export type UpdateIssueStatusInput = {
  provider: IssueProvider;
  config: IssueProviderConfig;
  apiToken: string;
  /** Provider id or key already stored on the issue link. */
  externalId: string;
  /** The provider's own status name, resolved from the connection's status map. */
  externalStatus: string;
  fetchImpl?: typeof fetch | undefined;
};

/**
 * Push one Herald status change to the linked external issue.
 *
 * The target is a provider status *name* (already resolved by the caller from
 * the connection's status map); this function only knows how each provider
 * addresses that name. GitHub has binary issue state, so every non-terminal
 * Herald status maps to `open` and only a terminal target closes the issue.
 *
 * Throws `IssueProviderError` with a safe message; the service records the
 * failure on the link and never fails the Herald write that triggered it.
 */
export async function updateIssueStatusInTracker(
  input: UpdateIssueStatusInput,
): Promise<{ externalStatus: string }> {
  const target = input.externalStatus.trim().slice(0, 100);
  if (!target) {
    throw new IssueProviderError("No external status is mapped to this Herald status.", 422);
  }

  if (input.provider === "linear") {
    const states = await providerJson<{
      data?: { team?: { states?: { nodes?: { id?: string; name?: string }[] } } };
      errors?: { message?: string }[];
    }>(input, "https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        authorization: input.apiToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query:
          "query TeamStates($teamId: String!) { team(id: $teamId) { states { nodes { id name } } } }",
        variables: { teamId: input.config.teamId },
      }),
    });
    const state = states.data?.team?.states?.nodes?.find(
      (node) => node.name?.toLowerCase() === target.toLowerCase(),
    );
    if (!state?.id) {
      throw new IssueProviderError(
        `Linear has no workflow state named "${target}".`,
        422,
      );
    }
    const result = await providerJson<{
      data?: {
        issueUpdate?: { success?: boolean; issue?: { state?: { name?: string } } };
      };
      errors?: { message?: string }[];
    }>(input, "https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        authorization: input.apiToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query:
          "mutation IssueUpdate($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success issue { state { name } } } }",
        variables: { id: input.externalId, stateId: state.id },
      }),
    });
    if (!result.data?.issueUpdate?.success) {
      throw new IssueProviderError(
        result.errors?.[0]?.message ?? "Linear did not update the issue.",
        422,
      );
    }
    return { externalStatus: result.data.issueUpdate.issue?.state?.name ?? target };
  }

  if (input.provider === "jira") {
    const base = input.config.baseUrl!.replace(/\/+$/, "");
    const auth = {
      authorization: `Basic ${Buffer.from(
        `${input.config.email}:${input.apiToken}`,
        "utf8",
      ).toString("base64")}`,
      accept: "application/json",
      "content-type": "application/json",
    };
    const transitions = await providerJson<{
      transitions?: { id: string; name: string; to?: { name?: string } }[];
    }>(input, `${base}/rest/api/3/issue/${encodeURIComponent(input.externalId)}/transitions`, {
      method: "GET",
      headers: auth,
    });
    const transition = transitions.transitions?.find((item) => {
      const name = item.to?.name ?? item.name;
      return name?.toLowerCase() === target.toLowerCase();
    });
    if (!transition) {
      throw new IssueProviderError(
        `Jira has no transition to "${target}" from the issue's current status.`,
        422,
      );
    }
    await providerJson<unknown>(
      input,
      `${base}/rest/api/3/issue/${encodeURIComponent(input.externalId)}/transitions`,
      {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ transition: { id: transition.id } }),
      },
    );
    return { externalStatus: transition.to?.name ?? target };
  }

  if (input.provider === "github") {
    const closed = ["closed", "done", "completed", "cancelled", "canceled"].includes(
      target.toLowerCase(),
    );
    const payload = await providerJson<{ state?: string }>(
      input,
      `https://api.github.com/repos/${encodeURIComponent(input.config.owner!)}/${encodeURIComponent(
        input.config.repo!,
      )}/issues/${encodeURIComponent(input.externalId)}`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${input.apiToken}`,
          accept: "application/vnd.github+json",
          "content-type": "application/json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "Herald",
        },
        body: JSON.stringify({ state: closed ? "closed" : "open" }),
      },
    );
    return { externalStatus: payload.state ?? (closed ? "closed" : "open") };
  }

  if (input.provider === "clickup") {
    const payload = await providerJson<{ status?: { status?: string } }>(
      input,
      `https://api.clickup.com/api/v2/task/${encodeURIComponent(input.externalId)}`,
      {
        method: "PUT",
        headers: {
          authorization: input.apiToken,
          "content-type": "application/json",
        },
        body: JSON.stringify({ status: target }),
      },
    );
    return { externalStatus: payload.status?.status ?? target };
  }

  const base = input.config.baseUrl!.replace(/\/+$/, "");
  const payload = await providerJson<{ fields?: Record<string, unknown> }>(
    input,
    `${base}/${encodeURIComponent(input.config.organization!)}/${encodeURIComponent(
      input.config.project!,
    )}/_apis/wit/workitems/${encodeURIComponent(input.externalId)}?api-version=7.1`,
    {
      method: "PATCH",
      headers: {
        authorization: `Basic ${Buffer.from(`:${input.apiToken}`, "utf8").toString("base64")}`,
        "content-type": "application/json-patch+json",
        accept: "application/json",
      },
      body: JSON.stringify([
        { op: "add", path: "/fields/System.State", value: target },
      ]),
    },
  );
  return {
    externalStatus:
      typeof payload.fields?.["System.State"] === "string"
        ? (payload.fields["System.State"] as string)
        : target,
  };
}
