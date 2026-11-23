import type { NextRequest } from "next/server";
import { z } from "zod";

import {
  jsonError,
  readCustomerSessionCookie,
  rejectCrossOrigin,
} from "@/features/customer-session/http";
import {
  consumeRateLimit,
  rateLimitKey,
} from "@/features/customer-session/rate-limit";
import { findActiveCustomerSession } from "@/features/customer-session/session";
import { publicSurfaceEnabled } from "@/features/entitlements/entitlements";
import { publicJson } from "@/features/public/actor";
import { setReleaseReaction } from "@/features/public/release-engagement";
import { resolvePublicChangelogProduct } from "@/features/public/resolver";

/**
 * Reactions on a published public changelog entry.
 *
 * Unlike board participation, reacting is tied to an identified customer of
 * the resolved workspace; there is no guest fallback. The tenant comes from
 * the query string, and the release id is checked inside that product.
 */

export const dynamic = "force-dynamic";

const kindSchema = z.enum(["like", "love", "celebrate"]);
type ReactionKind = z.infer<typeof kindSchema>;

async function releaseContext(request: NextRequest, releaseId: string) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return { ok: false as const, response: crossOrigin };

  const url = new URL(request.url);
  const workspaceSlug = url.searchParams.get("workspaceSlug");
  const productSlug = url.searchParams.get("productSlug");
  if (!workspaceSlug || !productSlug) {
    return { ok: false as const, response: jsonError(404, "Not found.") };
  }

  const tenant = await resolvePublicChangelogProduct({ workspaceSlug, productSlug });
  if (!tenant || !publicSurfaceEnabled(tenant.workspace.plan)) {
    return { ok: false as const, response: jsonError(404, "Not found.") };
  }

  const active = await findActiveCustomerSession(readCustomerSessionCookie(request));
  if (
    !active ||
    active.session.workspaceId !== tenant.workspace.id ||
    active.session.guest ||
    active.customer.email === null
  ) {
    return {
      ok: false as const,
      response: jsonError(401, "Sign in to react to updates."),
    };
  }

  return {
    ok: true as const,
    tenant,
    customerId: active.customer.id,
    releaseId,
  };
}

async function handle(
  request: NextRequest,
  releaseId: string,
  kind: ReactionKind,
  reacted: boolean,
): Promise<Response> {
  const context = await releaseContext(request, releaseId);
  if (!context.ok) return context.response;

  const limit = await consumeRateLimit({
    bucket: rateLimitKey(request, "public:release-reaction"),
    limit: 120,
    windowSeconds: 60 * 60,
  });
  if (!limit.allowed) {
    return publicJson({ error: "Too many changes. Please try again later." }, 429);
  }

  const result = await setReleaseReaction({
    productId: context.tenant.product.id,
    releaseId: context.releaseId,
    customerId: context.customerId,
    kind,
    reacted,
  });
  if (!result.ok) return publicJson({ error: result.error }, result.status);

  return publicJson({ reacted: result.reacted, count: result.count });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ releaseId: string }> },
): Promise<Response> {
  const body: unknown = await request.json().catch(() => null);
  const parsed = kindSchema.safeParse((body as { kind?: unknown } | null)?.kind);
  if (!parsed.success) return publicJson({ error: "Choose a reaction." }, 400);

  const { releaseId } = await context.params;
  return handle(request, releaseId, parsed.data, true);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ releaseId: string }> },
): Promise<Response> {
  const parsed = kindSchema.safeParse(new URL(request.url).searchParams.get("kind"));
  if (!parsed.success) return publicJson({ error: "Choose a reaction." }, 400);

  const { releaseId } = await context.params;
  return handle(request, releaseId, parsed.data, false);
}