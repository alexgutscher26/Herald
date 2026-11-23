"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { authorizeProductAction } from "@/features/live/action-auth";
import { disconnectGithubInstallation } from "@/features/github/service";
import {
  disconnectSupportToolConnection,
  rotateSupportToolWebhookToken,
  saveSupportToolConnection,
} from "@/features/support-tools/service";

import {
  createIssueForFeedback,
  disconnectIssueConnection,
  getFeedbackIntegrationView,
  linkExistingIssue,
  rotateIssueWebhookToken,
  saveIssueConnection,
  type CreateIssueResult,
  type FeedbackIntegrationView,
} from "./issue-service";
import {
  disconnectCrm,
  enqueueCrmConnectionSync,
  listCrmConnections,
  saveCrmConnection,
} from "./crm-service";
import {
  ISSUE_PROVIDERS,
  defaultStatusMap,
  isIssueProvider,
  type IssueProvider,
} from "./issue-providers";
import { isCrmProvider } from "./crm-providers";

const SUPPORT_TOOL_PROVIDERS = ["intercom", "zendesk"] as const;

function isSupportToolProvider(value: unknown): value is (typeof SUPPORT_TOOL_PROVIDERS)[number] {
  return typeof value === "string" && (SUPPORT_TOOL_PROVIDERS as readonly string[]).includes(value);
}

const targetSchema = z.object({
  workspaceSlug: z.string().min(1),
  productSlug: z.string().min(1),
});

function pagePath(
  workspaceSlug: string,
  productSlug: string,
  query: Record<string, string>,
): string {
  const params = new URLSearchParams(query);
  return `/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
    productSlug,
  )}/integrations?${params.toString()}`;
}

function formTarget(formData: FormData): z.infer<typeof targetSchema> | null {
  const parsed = targetSchema.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    productSlug: formData.get("productSlug"),
  });
  return parsed.success ? parsed.data : null;
}

function text(formData: FormData, key: string, max = 2_000): string {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

function issueConfig(formData: FormData, provider: IssueProvider): Record<string, unknown> {
  if (provider === "linear") return { teamId: text(formData, "linearTeamId", 200) };
  if (provider === "jira") {
    return {
      baseUrl: text(formData, "jiraUrl", 2_000),
      email: text(formData, "jiraEmail", 320),
      projectKey: text(formData, "jiraProjectKey", 100),
      issueType: text(formData, "jiraIssueType", 100),
    };
  }
  if (provider === "github") {
    return {
      owner: text(formData, "githubOwner", 200),
      repo: text(formData, "githubRepo", 200),
    };
  }
  if (provider === "clickup") return { listId: text(formData, "clickupListId", 200) };
  return {
    baseUrl: text(formData, "azureUrl", 2_000),
    organization: text(formData, "azureOrganization", 200),
    project: text(formData, "azureProject", 200),
    workItemType: text(formData, "azureWorkItemType", 100),
    areaPath: text(formData, "azureAreaPath", 500),
  };
}

function parseStatusMapField(
  formData: FormData,
  provider: IssueProvider,
): Record<string, unknown> | null {
  const raw = text(formData, "statusMap", 8_000);
  if (raw === "") return defaultStatusMap(provider);
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function saveIssueTrackerAction(formData: FormData): Promise<void> {
  const target = formTarget(formData);
  const provider = formData.get("provider");
  if (!target || !isIssueProvider(provider)) {
    redirect("/app?error=invalid_integration");
  }

  const authorized = await authorizeProductAction(
    target.workspaceSlug,
    target.productSlug,
    "integration:manage",
  );
  if ("error" in authorized) {
    redirect(
      pagePath(target.workspaceSlug, target.productSlug, {
        error: authorized.error.error,
      }),
    );
  }

  const statusMap = parseStatusMapField(formData, provider);
  if (!statusMap) {
    redirect(
      pagePath(target.workspaceSlug, target.productSlug, {
        error: "The status map must be a JSON object of external status names to Herald statuses.",
      }),
    );
  }

  const saved = await saveIssueConnection({
    workspaceId: authorized.context.workspace.id,
    productId: authorized.context.product.id,
    userId: authorized.context.user.id,
    provider,
    name: text(formData, "name", 100),
    config: issueConfig(formData, provider),
    statusMap: statusMap as Record<string, string>,
    apiToken: text(formData, "apiToken", 10_000) || undefined,
    webhookSecret: text(formData, "webhookSecret", 10_000) || undefined,
  });

  revalidatePath(pagePath(target.workspaceSlug, target.productSlug, {}));
  if (!saved.ok) {
    redirect(
      pagePath(target.workspaceSlug, target.productSlug, { error: saved.error }),
    );
  }
  redirect(
    pagePath(target.workspaceSlug, target.productSlug, {
      issue: "saved",
    }),
  );
}

export async function disconnectIssueTrackerAction(formData: FormData): Promise<void> {
  const target = formTarget(formData);
  const provider = formData.get("provider");
  if (!target || !isIssueProvider(provider)) {
    redirect("/app?error=invalid_integration");
  }
  const authorized = await authorizeProductAction(
    target.workspaceSlug,
    target.productSlug,
    "integration:manage",
  );
  if ("error" in authorized) {
    redirect(pagePath(target.workspaceSlug, target.productSlug, { error: authorized.error.error }));
  }

  await disconnectIssueConnection({
    workspaceId: authorized.context.workspace.id,
    productId: authorized.context.product.id,
    userId: authorized.context.user.id,
    provider,
  });
  revalidatePath(pagePath(target.workspaceSlug, target.productSlug, {}));
  redirect(pagePath(target.workspaceSlug, target.productSlug, { issue: "disconnected" }));
}

export async function rotateIssueWebhookTokenAction(formData: FormData): Promise<void> {
  const target = formTarget(formData);
  const provider = formData.get("provider");
  if (!target || !isIssueProvider(provider)) redirect("/app?error=invalid_integration");
  if (provider !== "jira" && provider !== "azure_devops") {
    redirect(pagePath(target.workspaceSlug, target.productSlug, { error: "This provider signs its webhooks." }));
  }
  const authorized = await authorizeProductAction(
    target.workspaceSlug,
    target.productSlug,
    "integration:manage",
  );
  if ("error" in authorized) {
    redirect(pagePath(target.workspaceSlug, target.productSlug, { error: authorized.error.error }));
  }
  const rotated = await rotateIssueWebhookToken({
    workspaceId: authorized.context.workspace.id,
    productId: authorized.context.product.id,
    userId: authorized.context.user.id,
    provider,
  });
  revalidatePath(pagePath(target.workspaceSlug, target.productSlug, {}));
  redirect(
    pagePath(target.workspaceSlug, target.productSlug, {
      issue: rotated ? "token_rotated" : "missing",
    }),
  );
}

export async function saveCrmAction(formData: FormData): Promise<void> {
  const target = formTarget(formData);
  const provider = formData.get("provider");
  if (!target || !isCrmProvider(provider)) {
    redirect("/app?error=invalid_integration");
  }
  const authorized = await authorizeProductAction(
    target.workspaceSlug,
    target.productSlug,
    "integration:manage",
  );
  if ("error" in authorized) {
    redirect(pagePath(target.workspaceSlug, target.productSlug, { error: authorized.error.error }));
  }

  const saved = await saveCrmConnection({
    workspaceId: authorized.context.workspace.id,
    userId: authorized.context.user.id,
    provider,
    name: text(formData, "name", 100),
    apiToken: text(formData, "apiToken", 10_000) || undefined,
    instanceUrl: text(formData, "instanceUrl", 2_000) || undefined,
  });
  if (!saved.ok) {
    redirect(pagePath(target.workspaceSlug, target.productSlug, { error: saved.error }));
  }

  await enqueueCrmConnectionSync({
    connectionId: saved.id,
    dedupeKey: `crm-sync:${saved.id}:manual:${new Date().toISOString().slice(0, 13)}`,
  }).catch(() => undefined);

  revalidatePath(pagePath(target.workspaceSlug, target.productSlug, {}));
  redirect(pagePath(target.workspaceSlug, target.productSlug, { crm: "saved" }));
}

export async function syncCrmNowAction(formData: FormData): Promise<void> {
  const target = formTarget(formData);
  const provider = formData.get("provider");
  if (!target || !isCrmProvider(provider)) redirect("/app?error=invalid_integration");
  const authorized = await authorizeProductAction(
    target.workspaceSlug,
    target.productSlug,
    "integration:manage",
  );
  if ("error" in authorized) {
    redirect(pagePath(target.workspaceSlug, target.productSlug, { error: authorized.error.error }));
  }

  const connections = await listCrmConnections(authorized.context.workspace.id);
  const connection = connections.find((row) => row.provider === provider && row.active);
  if (!connection) {
    redirect(pagePath(target.workspaceSlug, target.productSlug, { error: "Connect that CRM first." }));
  }
  await enqueueCrmConnectionSync({
    connectionId: connection.id,
    dedupeKey: `crm-sync:${connection.id}:manual:${new Date().toISOString().slice(0, 13)}`,
  });
  redirect(pagePath(target.workspaceSlug, target.productSlug, { crm: "queued" }));
}

export async function disconnectCrmAction(formData: FormData): Promise<void> {
  const target = formTarget(formData);
  const provider = formData.get("provider");
  if (!target || !isCrmProvider(provider)) redirect("/app?error=invalid_integration");
  const authorized = await authorizeProductAction(
    target.workspaceSlug,
    target.productSlug,
    "integration:manage",
  );
  if ("error" in authorized) {
    redirect(pagePath(target.workspaceSlug, target.productSlug, { error: authorized.error.error }));
  }
  await disconnectCrm({
    workspaceId: authorized.context.workspace.id,
    userId: authorized.context.user.id,
    provider,
  });
  revalidatePath(pagePath(target.workspaceSlug, target.productSlug, {}));
  redirect(pagePath(target.workspaceSlug, target.productSlug, { crm: "disconnected" }));
}

export async function disconnectGithubInstallationAction(formData: FormData): Promise<void> {
  const target = formTarget(formData);
  if (!target) redirect("/app?error=invalid_integration");
  const authorized = await authorizeProductAction(
    target.workspaceSlug,
    target.productSlug,
    "integration:manage",
  );
  if ("error" in authorized) {
    redirect(pagePath(target.workspaceSlug, target.productSlug, { error: authorized.error.error }));
  }
  await disconnectGithubInstallation({
    workspaceId: authorized.context.workspace.id,
    productId: authorized.context.product.id,
    userId: authorized.context.user.id,
  });
  revalidatePath(pagePath(target.workspaceSlug, target.productSlug, {}));
  redirect(pagePath(target.workspaceSlug, target.productSlug, { github: "disconnected" }));
}

export async function saveSupportToolAction(formData: FormData): Promise<void> {
  const target = formTarget(formData);
  const provider = formData.get("provider");
  if (!target || !isSupportToolProvider(provider)) redirect("/app?error=invalid_integration");

  const authorized = await authorizeProductAction(
    target.workspaceSlug,
    target.productSlug,
    "integration:manage",
  );
  if ("error" in authorized) {
    redirect(pagePath(target.workspaceSlug, target.productSlug, { error: authorized.error.error }));
  }

  const saved = await saveSupportToolConnection({
    workspaceId: authorized.context.workspace.id,
    productId: authorized.context.product.id,
    userId: authorized.context.user.id,
    provider,
    boardId: text(formData, "boardId", 100),
    name: text(formData, "name", 100),
  });
  revalidatePath(pagePath(target.workspaceSlug, target.productSlug, {}));
  if (!saved.ok) {
    redirect(pagePath(target.workspaceSlug, target.productSlug, { error: saved.error }));
  }
  redirect(pagePath(target.workspaceSlug, target.productSlug, { support: "saved" }));
}

export async function disconnectSupportToolAction(formData: FormData): Promise<void> {
  const target = formTarget(formData);
  const provider = formData.get("provider");
  if (!target || !isSupportToolProvider(provider)) redirect("/app?error=invalid_integration");
  const authorized = await authorizeProductAction(
    target.workspaceSlug,
    target.productSlug,
    "integration:manage",
  );
  if ("error" in authorized) {
    redirect(pagePath(target.workspaceSlug, target.productSlug, { error: authorized.error.error }));
  }
  await disconnectSupportToolConnection({
    workspaceId: authorized.context.workspace.id,
    productId: authorized.context.product.id,
    userId: authorized.context.user.id,
    provider,
  });
  revalidatePath(pagePath(target.workspaceSlug, target.productSlug, {}));
  redirect(pagePath(target.workspaceSlug, target.productSlug, { support: "disconnected" }));
}

export async function rotateSupportToolTokenAction(formData: FormData): Promise<void> {
  const target = formTarget(formData);
  const provider = formData.get("provider");
  if (!target || !isSupportToolProvider(provider)) redirect("/app?error=invalid_integration");
  const authorized = await authorizeProductAction(
    target.workspaceSlug,
    target.productSlug,
    "integration:manage",
  );
  if ("error" in authorized) {
    redirect(pagePath(target.workspaceSlug, target.productSlug, { error: authorized.error.error }));
  }
  const rotated = await rotateSupportToolWebhookToken({
    workspaceId: authorized.context.workspace.id,
    productId: authorized.context.product.id,
    userId: authorized.context.user.id,
    provider,
  });
  revalidatePath(pagePath(target.workspaceSlug, target.productSlug, {}));
  redirect(
    pagePath(target.workspaceSlug, target.productSlug, {
      support: rotated ? "token_rotated" : "missing",
    }),
  );
}

const feedbackTarget = targetSchema.extend({
  postId: z.uuid(),
  provider: z.enum(ISSUE_PROVIDERS),
});

export async function getFeedbackIntegrationViewAction(input: {
  workspaceSlug: string;
  productSlug: string;
  postId: string;
}): Promise<{ ok: true; data: FeedbackIntegrationView } | { ok: false; error: string }> {
  const parsed = targetSchema.extend({ postId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid feedback request." };
  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "feedback:read",
  );
  if ("error" in authorized) return authorized.error;
  const data = await getFeedbackIntegrationView({
    workspaceId: authorized.context.workspace.id,
    productId: authorized.context.product.id,
    feedbackPostId: parsed.data.postId,
  });
  return { ok: true, data };
}

export async function createIssueForFeedbackAction(input: {
  workspaceSlug: string;
  productSlug: string;
  postId: string;
  provider: IssueProvider;
}): Promise<CreateIssueResult> {
  const parsed = feedbackTarget.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid issue tracker." };
  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "feedback:write",
  );
  if ("error" in authorized) return authorized.error;
  const result = await createIssueForFeedback({
    workspaceId: authorized.context.workspace.id,
    productId: authorized.context.product.id,
    userId: authorized.context.user.id,
    feedbackPostId: parsed.data.postId,
    provider: parsed.data.provider,
  });
  if (result.ok) {
    revalidatePath(
      `/app/${parsed.data.workspaceSlug}/${parsed.data.productSlug}/feedback`,
      "layout",
    );
  }
  return result;
}

export async function linkExistingIssueAction(input: {
  workspaceSlug: string;
  productSlug: string;
  postId: string;
  provider: IssueProvider;
  externalId: string;
  externalKey?: string | undefined;
  externalUrl?: string | undefined;
}): Promise<CreateIssueResult> {
  const parsed = feedbackTarget
    .extend({
      externalId: z.string().trim().min(1).max(300),
      externalKey: z.string().trim().max(200).optional(),
      externalUrl: z.string().trim().max(2_000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter an issue id or key." };
  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "feedback:write",
  );
  if ("error" in authorized) return authorized.error;
  const result = await linkExistingIssue({
    workspaceId: authorized.context.workspace.id,
    productId: authorized.context.product.id,
    userId: authorized.context.user.id,
    feedbackPostId: parsed.data.postId,
    provider: parsed.data.provider,
    externalId: parsed.data.externalId,
    externalKey: parsed.data.externalKey,
    externalUrl: parsed.data.externalUrl,
  });
  if (result.ok) {
    revalidatePath(
      `/app/${parsed.data.workspaceSlug}/${parsed.data.productSlug}/feedback`,
      "layout",
    );
  }
  return result;
}

