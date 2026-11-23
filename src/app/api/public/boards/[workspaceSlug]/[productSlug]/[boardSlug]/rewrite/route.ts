import type { NextRequest } from "next/server";
import { z } from "zod";

import {
  consumeRateLimit,
  rateLimitKey,
} from "@/features/customer-session/rate-limit";
import { rejectCrossOrigin } from "@/features/customer-session/http";
import { publicSurfaceEnabled } from "@/features/entitlements/entitlements";
import { publicJson } from "@/features/public/actor";
import { resolvePublicBoard } from "@/features/public/resolver";
import {
  rewriteSubmission,
  submissionAssistantAvailable,
} from "@/features/public/rewrite";
import { reportError } from "@/lib/error-report";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  title: z.string().trim().min(3).max(140),
  body: z.string().trim().min(10).max(5_000),
});

type Params = {
  workspaceSlug: string;
  productSlug: string;
  boardSlug: string;
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<Params> },
): Promise<Response> {
  const params = await context.params;

  try {
    const crossOrigin = rejectCrossOrigin(request);
    if (crossOrigin) return crossOrigin;

    const tenant = await resolvePublicBoard(params);
    if (!tenant || !publicSurfaceEnabled(tenant.workspace.plan)) {
      return publicJson({ error: "Board not found." }, 404);
    }
    if (!(await submissionAssistantAvailable(tenant.product.id))) {
      return publicJson({ error: "The writing assistant is not enabled." }, 404);
    }

    const limit = await consumeRateLimit({
      bucket: rateLimitKey(request, "public:rewrite"),
      limit: 6,
      windowSeconds: 60 * 60,
    });
    if (!limit.allowed) {
      return publicJson(
        { error: "Too many rewrites. You can still submit the request as written." },
        429,
      );
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return publicJson({ error: "Write a title and details first." }, 400);
    }

    const result = await rewriteSubmission({
      productId: tenant.product.id,
      productName: tenant.product.name,
      title: parsed.data.title,
      body: parsed.data.body,
    });
    if (!result.ok) {
      return publicJson({ error: result.error }, result.status);
    }

    return publicJson({ rewrite: result.rewrite });
  } catch (error) {
    await reportError(error, { route: "public.rewrite" }, "public.rewrite_failed");
    return publicJson(
      { error: "The writing assistant is unavailable. You can still submit as written." },
      500,
    );
  }
}
