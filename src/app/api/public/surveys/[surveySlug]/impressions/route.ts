import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { recordSurveyImpression } from "@/features/engagement/service";
import { rejectCrossOrigin } from "@/features/customer-session/http";
import {
  consumeRateLimit,
  rateLimitKey,
} from "@/features/customer-session/rate-limit";

export const dynamic = "force-dynamic";

const COOKIE = "herald_experience_visitor";

const bodySchema = z.object({
  workspaceSlug: z.string().min(1).max(120),
  productSlug: z.string().min(1).max(120),
});

/**
 * Record a survey impression when the prompt was actually rendered.
 *
 * Called by the widget iframe, not the host page, so the visitor cookie is
 * first-party. The server deduplicates per visitor and UTC day and stops at
 * the plan's monthly allowance.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ surveySlug: string }> },
) {
  const blocked = rejectCrossOrigin(request);
  if (blocked) return blocked;

  // One visitor can only produce a handful of impressions a day; this bounds
  // cookie-spawning attempts to exhaust a Free plan's monthly allowance.
  const limit = await consumeRateLimit({
    bucket: rateLimitKey(request, "public:survey-impression"),
    limit: 60,
    windowSeconds: 60 * 60,
  });
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many impressions." }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the request and try again." }, { status: 400 });
  }

  const visitorKey = request.cookies.get(COOKIE)?.value ?? "";
  if (visitorKey.length < 8) {
    return NextResponse.json({ error: "Visitor key missing." }, { status: 400 });
  }

  const { surveySlug } = await params;
  const result = await recordSurveyImpression({
    workspaceSlug: parsed.data.workspaceSlug,
    productSlug: parsed.data.productSlug,
    slug: surveySlug,
    visitorKey,
  });

  if (result.capped) {
    return NextResponse.json(
      { error: "The survey impression allowance is used up." },
      { status: 429, headers: { "cache-control": "no-store" } },
    );
  }
  if (!result.ok) {
    return NextResponse.json({ error: "Survey not found." }, { status: 404 });
  }
  return new NextResponse(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}
