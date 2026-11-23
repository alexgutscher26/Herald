import { NextResponse } from "next/server";

import {
  isDashboardSurface,
  normalizeSections,
  recordDashboardViews,
} from "@/features/analytics/dashboard-views";
import { isSameOriginRequest } from "@/features/customer-session/origin";
import { findMembershipBySlug, findProductInWorkspace } from "@/db/queries/workspaces";
import { getSessionUser } from "@/lib/authz";
import { getServerEnv } from "@/lib/env";
import { withRouteInstrumentation } from "@/lib/observability/route";

/**
 * Dashboard product analytics ingest.
 *
 * This is an internal, first-party endpoint: it requires a signed-in workspace
 * member, checks the request origin, accepts only the fixed surface and section
 * allowlists, and stores no content from the page. It answers 202 even when the
 * best-effort insert fails so a settings page is never affected by analytics.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

function json(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

async function handle(
  request: Request,
  context?: unknown,
): Promise<NextResponse> {
  const { workspaceSlug } = (await (context as {
    params: Promise<{ workspaceSlug: string }>;
  }).params);
  if (!workspaceSlug) return json({ ok: false, error: "Not found." }, 404);

  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(getServerEnv().BETTER_AUTH_URL).origin;
  } catch {
    return json({ ok: false, error: "Analytics is not configured." }, 503);
  }

  const sameOrigin = isSameOriginRequest({
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
    expectedOrigin,
  });
  if (!sameOrigin) return json({ ok: false, error: "This request was rejected." }, 403);

  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "Sign in required." }, 401);

  const membership = await findMembershipBySlug(workspaceSlug, user.id);
  if (!membership) return json({ ok: false, error: "Not found." }, 404);

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, error: "Invalid body." }, 400);
  }

  const record = body as Record<string, unknown>;
  if (!isDashboardSurface(record.surface)) {
    return json({ ok: false, error: "Unknown surface." }, 400);
  }

  const sections = normalizeSections(record.sections);
  if (sections.length === 0) {
    return json({ ok: false, error: "No valid sections." }, 400);
  }

  let productId: string | null = null;
  if (record.surface === "product_settings") {
    const productSlug = typeof record.productSlug === "string" ? record.productSlug : "";
    if (!productSlug) return json({ ok: false, error: "Product is required." }, 400);
    const product = await findProductInWorkspace(membership.workspace.id, productSlug);
    if (!product) return json({ ok: false, error: "Not found." }, 404);
    productId = product.id;
  }

  const recorded = await recordDashboardViews({
    workspaceId: membership.workspace.id,
    productId,
    userId: user.id,
    surface: record.surface,
    sections,
  });

  return json({ ok: true, recorded }, 202);
}

export const POST = withRouteInstrumentation(
  "POST /api/app/[workspaceSlug]/dashboard-views",
  handle,
);
