import { NextResponse } from "next/server";

import { checkWorkspaceLimit } from "@/features/entitlements/entitlements";
import { authorizeAppApi } from "@/features/app-api/auth";
import { getSlackConfig, SLACK_SCOPES } from "@/features/slack/config";
import { createSlackInstallState, getSlackIntegration } from "@/features/slack/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function integrationsPath(workspaceSlug: string, productSlug: string, query = ""): string {
  const base = `/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
    productSlug,
  )}/integrations`;
  return query ? `${base}?${query}` : base;
}

/**
 * Redirect with a site-relative `Location`.
 *
 * `request.url` carries whatever host and scheme the proxy forwarded, which is
 * not the origin the browser is on behind a tunnel or load balancer; a relative
 * reference resolves against the origin the browser actually used.
 */
function redirectTo(path: string): Response {
  return new NextResponse(null, { status: 307, headers: { Location: path } });
}

/** Start a Slack OAuth install for one product. */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const workspaceSlug = url.searchParams.get("workspaceSlug")?.trim() ?? "";
  const productSlug = url.searchParams.get("productSlug")?.trim() ?? "";
  if (!workspaceSlug || !productSlug) {
    return NextResponse.json({ error: "Missing workspace or product." }, { status: 400 });
  }

  const authorized = await authorizeAppApi({
    request,
    workspaceSlug,
    productSlug,
    permission: "settings:manage",
  });
  if (!authorized.ok) return authorized.response;

  let config;
  try {
    config = getSlackConfig();
  } catch {
    return redirectTo(integrationsPath(workspaceSlug, productSlug, "error=configuration"));
  }
  if (!config) {
    return redirectTo(integrationsPath(workspaceSlug, productSlug, "error=not_configured"));
  }

  const existing = await getSlackIntegration(authorized.context.product.id);
  if (!existing?.active) {
    const limit = await checkWorkspaceLimit(
      authorized.context.workspace.id,
      "integrations",
    );
    if (!limit.allowed) {
      return redirectTo(
        integrationsPath(workspaceSlug, productSlug, "error=integration_limit"),
      );
    }
  }

  const state = await createSlackInstallState({
    workspaceId: authorized.context.workspace.id,
    productId: authorized.context.product.id,
    userId: authorized.context.user.id,
  });

  const authorizeUrl = new URL(config.SLACK_AUTHORIZE_URL);
  authorizeUrl.searchParams.set("client_id", config.SLACK_CLIENT_ID);
  authorizeUrl.searchParams.set("scope", SLACK_SCOPES);
  authorizeUrl.searchParams.set("redirect_uri", config.SLACK_REDIRECT_URI);
  authorizeUrl.searchParams.set("state", state);
  return NextResponse.redirect(authorizeUrl);
}
