import { createHash } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { products } from "@/db/schema";
import { requestMagicLink } from "@/features/customer-auth/magic-link";
import { sanitizeNextPath } from "@/features/customer-auth/next-path";
import {
  NO_STORE,
  jsonError,
  rejectCrossOrigin,
} from "@/features/customer-session/http";
import {
  consumeRateLimit,
  rateLimitKey,
} from "@/features/customer-session/rate-limit";
import { publicSurfaceEnabled } from "@/features/entitlements/entitlements";
import { resolvePublicWorkspace } from "@/features/public/resolver";
import { isValidEmail, normalizeEmail } from "@/lib/email";
import { validateSlug } from "@/lib/slug";

/**
 * Request a customer magic link.
 *
 * The response is intentionally the same whether or not the address already
 * has a customer: a link is emailed, and the account is created on consumption.
 * The endpoint refuses to run when outbound email is not configured rather than
 * pretending a link was sent.
 */

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  workspaceSlug: z.string().trim().min(1).max(80),
  productSlug: z.string().trim().min(1).max(80),
  email: z.string().trim().min(3).max(254),
  nextPath: z.string().trim().max(500).optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const ipLimit = await consumeRateLimit({
    bucket: rateLimitKey(request, "magic-link:request"),
    limit: 5,
    windowSeconds: 60,
  });
  if (!ipLimit.allowed) {
    return jsonError(429, "Too many sign-in attempts. Try again in a minute.");
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "Enter a valid email address.");
  if (!isValidEmail(parsed.data.email)) {
    return jsonError(400, "Enter a valid email address.");
  }

  const workspaceSlug = validateSlug(parsed.data.workspaceSlug);
  const productSlug = validateSlug(parsed.data.productSlug);
  if (!workspaceSlug.ok || !productSlug.ok) {
    return jsonError(404, "Workspace not found.");
  }

  const workspace = await resolvePublicWorkspace(workspaceSlug.slug);
  if (!workspace || !publicSurfaceEnabled(workspace.plan)) {
    return jsonError(404, "Workspace not found.");
  }

  const productRows = await db
    .select({ name: products.name })
    .from(products)
    .where(
      and(
        eq(products.workspaceId, workspace.id),
        eq(products.slug, productSlug.slug),
      ),
    )
    .limit(1);
  const product = productRows[0];
  if (!product) return jsonError(404, "Workspace not found.");

  const emailLimit = await consumeRateLimit({
    bucket: `magic-link:email:${createHash("sha256")
      .update(`${workspace.id}:${normalizeEmail(parsed.data.email)}`)
      .digest("hex")}`,
    limit: 3,
    windowSeconds: 600,
  });
  if (!emailLimit.allowed) {
    return jsonError(429, "A link was already sent. Check your inbox.");
  }

  const result = await requestMagicLink({
    workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug },
    productName: product.name,
    email: parsed.data.email,
    nextPath: sanitizeNextPath(parsed.data.nextPath),
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status, headers: NO_STORE },
    );
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
