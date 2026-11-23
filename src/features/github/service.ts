import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { githubAppInstallations } from "@/db/schema";
import { recordWorkspaceAudit } from "@/features/data-controls/service";
import { logEvent, serializeError } from "@/lib/logger";

import { createGithubAppJwt, getGithubAppConfig } from "./app";

const GITHUB_API = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 15_000;

export type GithubInstallationView = {
  installationId: string;
  accountLogin: string;
  accountType: string;
  repositorySelection: string;
  active: boolean;
  installedAt: string;
};

export async function getGithubInstallationForProduct(
  productId: string,
): Promise<GithubInstallationView | null> {
  const rows = await db
    .select()
    .from(githubAppInstallations)
    .where(
      and(
        eq(githubAppInstallations.productId, productId),
        eq(githubAppInstallations.active, true),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    installationId: row.installationId,
    accountLogin: row.accountLogin,
    accountType: row.accountType,
    repositorySelection: row.repositorySelection,
    active: row.active,
    installedAt: row.createdAt.toISOString(),
  };
}

export async function fetchGithubInstallation(input: {
  installationId: string;
  fetchImpl?: typeof fetch;
}): Promise<{
  accountLogin: string;
  accountType: string;
  repositorySelection: string;
} | null> {
  const config = getGithubAppConfig();
  if (!config) return null;
  const jwt = createGithubAppJwt({
    appId: config.GITHUB_APP_ID,
    privateKey: config.GITHUB_APP_PRIVATE_KEY,
  });

  const response = await (input.fetchImpl ?? fetch)(
    `${GITHUB_API}/app/installations/${encodeURIComponent(input.installationId)}`,
    {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${jwt}`,
        "user-agent": "Herald-GitHub-App",
        "x-github-api-version": "2022-11-28",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    },
  );
  if (!response.ok) return null;

  const payload = (await response.json().catch(() => null)) as
    | {
        account?: { login?: unknown; type?: unknown };
        repository_selection?: unknown;
      }
    | null;
  if (!payload || typeof payload.account?.login !== "string") return null;
  return {
    accountLogin: payload.account.login.slice(0, 200),
    accountType:
      typeof payload.account.type === "string" ? payload.account.type.slice(0, 50) : "Organization",
    repositorySelection:
      payload.repository_selection === "selected" ? "selected" : "all",
  };
}

export async function saveGithubInstallation(input: {
  workspaceId: string;
  productId: string;
  userId: string;
  installationId: string;
  accountLogin: string;
  accountType: string;
  repositorySelection: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const existingRows = await db
    .select({ id: githubAppInstallations.id })
    .from(githubAppInstallations)
    .where(eq(githubAppInstallations.productId, input.productId))
    .limit(1);

  try {
    if (existingRows[0]) {
      await db
        .update(githubAppInstallations)
        .set({
          installationId: input.installationId,
          accountLogin: input.accountLogin,
          accountType: input.accountType,
          repositorySelection: input.repositorySelection,
          active: true,
          installedBy: input.userId,
          updatedAt: new Date(),
        })
        .where(eq(githubAppInstallations.id, existingRows[0].id));
    } else {
      await db.insert(githubAppInstallations).values({
        workspaceId: input.workspaceId,
        productId: input.productId,
        installationId: input.installationId,
        accountLogin: input.accountLogin,
        accountType: input.accountType,
        repositorySelection: input.repositorySelection,
        installedBy: input.userId,
      });
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "23505") {
      return { ok: false, error: "That GitHub installation is already connected to another product." };
    }
    throw error;
  }

  await recordWorkspaceAudit({
    workspaceId: input.workspaceId,
    actorUserId: input.userId,
    action: "integration.github.connected",
    targetType: "github_app_installation",
    targetId: input.installationId,
    metadata: {
      account: input.accountLogin,
      repository_selection: input.repositorySelection,
    },
  });
  return { ok: true };
}

export async function disconnectGithubInstallation(input: {
  workspaceId: string;
  productId: string;
  userId: string;
}): Promise<boolean> {
  const rows = await db
    .update(githubAppInstallations)
    .set({ active: false, updatedAt: new Date() })
    .where(
      and(
        eq(githubAppInstallations.productId, input.productId),
        eq(githubAppInstallations.workspaceId, input.workspaceId),
      ),
    )
    .returning({ id: githubAppInstallations.id, installationId: githubAppInstallations.installationId });
  const row = rows[0];
  if (!row) return false;

  await recordWorkspaceAudit({
    workspaceId: input.workspaceId,
    actorUserId: input.userId,
    action: "integration.github.disconnected",
    targetType: "github_app_installation",
    targetId: row.installationId,
  });
  return true;
}

/**
 * Mint a short-lived installation token for the import path.
 *
 * Returns null when the product has not connected the App or GitHub rejects the
 * installation, so a public repository import can still proceed anonymously.
 */
export async function getGithubInstallationTokenForProduct(
  productId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const config = getGithubAppConfig();
  if (!config) return null;

  const rows = await db
    .select({ installationId: githubAppInstallations.installationId })
    .from(githubAppInstallations)
    .where(
      and(
        eq(githubAppInstallations.productId, productId),
        eq(githubAppInstallations.active, true),
      ),
    )
    .limit(1);
  const installation = rows[0];
  if (!installation) return null;

  const jwt = createGithubAppJwt({
    appId: config.GITHUB_APP_ID,
    privateKey: config.GITHUB_APP_PRIVATE_KEY,
  });
  try {
    const response = await fetchImpl(
      `${GITHUB_API}/app/installations/${encodeURIComponent(
        installation.installationId,
      )}/access_tokens`,
      {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${jwt}`,
          "user-agent": "Herald-GitHub-App",
          "x-github-api-version": "2022-11-28",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      },
    );
    if (!response.ok) {
      logEvent("warn", "github.installation_token_failed", {
        productId,
        status: response.status,
      });
      return null;
    }
    const payload = (await response.json().catch(() => null)) as { token?: unknown } | null;
    return typeof payload?.token === "string" && payload.token !== "" ? payload.token : null;
  } catch (error) {
    logEvent("warn", "github.installation_token_error", {
      productId,
      error: serializeError(error),
    });
    return null;
  }
}
