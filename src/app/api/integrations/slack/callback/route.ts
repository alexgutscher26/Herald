import { NextResponse } from "next/server";

import { exchangeSlackCode } from "@/features/slack/client";
import { getSlackConfig } from "@/features/slack/config";
import {
  consumeSlackInstallState,
  upsertSlackIntegration,
} from "@/features/slack/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function integrationsPath(workspaceSlug: string, productSlug: string, query: string): string {
  const base = `/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
    productSlug,
  )}/integrations`;
  return query ? `${base}?${query}` : base;
}

/**
 * Redirect with a site-relative `Location`.
 *
 * `request.url` carries whatever host and scheme the proxy forwarded — behind a
 * tunnel or a terminating load balancer that is not the origin the browser is
 * on, so an absolute URL built from it can land elsewhere (a tunnel forwards
 * `Host: localhost:3000`, which turned this into `https://localhost:3000`). A
 * relative reference always resolves against the origin the browser used.
 */
function redirectTo(path: string): Response {
  return new NextResponse(null, { status: 307, headers: { Location: path } });
}

/** Finish the Slack OAuth exchange and save the installation. */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";

  if (error) {
    return redirectTo("/app?slack=cancelled");
  }
  if (!state) {
    return redirectTo("/app?slack=invalid_state");
  }

  const install = await consumeSlackInstallState(state);
  if (!install) {
    return redirectTo("/app?slack=invalid_state");
  }

  const page = integrationsPath(install.workspaceSlug, install.productSlug, "");
  let config;
  try {
    config = getSlackConfig();
  } catch {
    return redirectTo(`${page}?error=configuration`);
  }
  if (!config) {
    return redirectTo(`${page}?error=not_configured`);
  }
  if (!code) {
    return redirectTo(`${page}?error=missing_code`);
  }

  try {
    const result = await exchangeSlackCode(code, config.SLACK_REDIRECT_URI);
    const saved = await upsertSlackIntegration({
      workspaceId: install.workspaceId,
      productId: install.productId,
      userId: install.userId,
      teamId: result.team.id,
      teamName: result.team.name,
      botUserId: result.bot_user_id ?? null,
      accessToken: result.access_token,
      scopes: result.scope ?? "",
    });
    if (!saved.ok) {
      return redirectTo(`${page}?error=${encodeURIComponent(saved.error)}`);
    }
  } catch {
    return redirectTo(`${page}?error=slack_install`);
  }

  return redirectTo(`${page}?slack=connected`);
}
