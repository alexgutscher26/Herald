import { NextResponse } from "next/server";

import { getGithubAppConfig, verifyGithubInstallState } from "@/features/github/app";
import {
  fetchGithubInstallation,
  saveGithubInstallation,
} from "@/features/github/service";
import { getSessionUser } from "@/lib/authz";
import { getServerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function integrationsPath(workspaceSlug: string, productSlug: string, query: string): string {
  return `/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
    productSlug,
  )}/integrations?${query}`;
}

/**
 * GitHub App setup callback.
 *
 * The state is HMAC-signed and tied to the signed-in user, so a callback cannot
 * attach an installation to a product the user cannot manage. The App JWT is
 * used once to read the installation and is never persisted.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const installationId = (url.searchParams.get("installation_id") ?? "").trim();
  const stateToken = url.searchParams.get("state") ?? "";
  const setupAction = url.searchParams.get("setup_action") ?? "install";

  let config;
  try {
    config = getGithubAppConfig();
  } catch {
    return NextResponse.json({ error: "The GitHub App configuration is invalid." }, { status: 503 });
  }
  if (!config) {
    return NextResponse.json({ error: "The GitHub App is not configured." }, { status: 503 });
  }

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.redirect(new URL("/sign-in", url.origin));
  }

  const state = verifyGithubInstallState(stateToken, {
    secret: getServerEnv().BETTER_AUTH_SECRET,
  });
  if (!state || state.userId !== user.id) {
    return NextResponse.json({ error: "That GitHub installation link expired." }, { status: 400 });
  }

  const workspaceSlug = state.workspaceSlug;
  const productSlug = state.productSlug;

  if (setupAction === "request") {
    return NextResponse.redirect(
      new URL(
        integrationsPath(workspaceSlug, productSlug, "github=requested"),
        url.origin,
      ),
    );
  }

  // GitHub does not echo arbitrary parameters. The signed state is authoritative
  // for the product and workspace; only the installation id comes from GitHub.
  if (!/^\d{1,20}$/.test(installationId)) {
    return NextResponse.json(
      { error: "GitHub sent an incomplete installation callback." },
      { status: 400 },
    );
  }

  const installation = await fetchGithubInstallation({ installationId });
  if (!installation) {
    return NextResponse.redirect(
      new URL(
        integrationsPath(workspaceSlug, productSlug, "github=lookup_failed"),
        url.origin,
      ),
    );
  }

  const saved = await saveGithubInstallation({
    workspaceId: state.workspaceId,
    productId: state.productId,
    userId: user.id,
    installationId,
    accountLogin: installation.accountLogin,
    accountType: installation.accountType,
    repositorySelection: installation.repositorySelection,
  });
  if (!saved.ok) {
    return NextResponse.redirect(
      new URL(
        integrationsPath(workspaceSlug, productSlug, `error=${encodeURIComponent(saved.error)}`),
        url.origin,
      ),
    );
  }

  return NextResponse.redirect(
    new URL(integrationsPath(workspaceSlug, productSlug, "github=connected"), url.origin),
  );
}
