import { NextResponse } from "next/server";

import { authorizeAppApi } from "@/features/app-api/auth";
import {
  createGithubInstallState,
  getGithubAppConfig,
  githubInstallUrl,
} from "@/features/github/app";
import { getServerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Start a GitHub App installation for the authorized product. */
export async function GET(
  request: Request,
): Promise<NextResponse> {
  const url = new URL(request.url);

  // The product identifiers travel in the signed state, not in a redirect URL
  // chosen by the client. Resolve them from the query only for the auth gate.
  const workspaceSlug = url.searchParams.get("workspaceSlug") ?? "";
  const productSlug = url.searchParams.get("productSlug") ?? "";
  if (!workspaceSlug || !productSlug) {
    return NextResponse.json({ error: "Choose a product." }, { status: 400 });
  }

  const authorized = await authorizeAppApi({
    request,
    workspaceSlug,
    productSlug,
    permission: "integration:manage",
  });
  if (!authorized.ok) return authorized.response;

  let config;
  try {
    config = getGithubAppConfig();
  } catch {
    return NextResponse.json({ error: "The GitHub App configuration is invalid." }, { status: 503 });
  }
  if (!config) {
    return NextResponse.json({ error: "The GitHub App is not configured." }, { status: 503 });
  }

  const state = createGithubInstallState(
    {
      workspaceId: authorized.context.workspace.id,
      productId: authorized.context.product.id,
      userId: authorized.context.user.id,
      workspaceSlug,
      productSlug,
    },
    { secret: getServerEnv().BETTER_AUTH_SECRET },
  );
  return NextResponse.redirect(githubInstallUrl(config, state));
}
