import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { submitSurveyResponse } from "@/features/engagement/service";
import { rejectCrossOrigin } from "@/features/customer-session/http";
import { enforcePublicWriteLimit } from "@/features/customer-session/public-write-limit";
import { getPublicViewer } from "@/features/public/viewer";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  workspaceSlug: z.string().min(1).max(120),
  productSlug: z.string().min(1).max(120),
  visitorKey: z.string().min(8).max(200),
  answers: z.record(z.string().max(60), z.string().max(4000)).default({}),
  optIn: z.boolean().default(false),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ surveySlug: string }> },
) {
  const blocked = rejectCrossOrigin(request);
  if (blocked) return blocked;

  const limited = await enforcePublicWriteLimit(request, "public:survey-response", 20);
  if (limited) return limited;

  const { surveySlug } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Check your answers and try again." }, { status: 400 });
  }

  const viewer = await getPublicViewer();
  const result = await submitSurveyResponse({
    workspaceSlug: parsed.data.workspaceSlug,
    productSlug: parsed.data.productSlug,
    slug: surveySlug,
    visitorKey: parsed.data.visitorKey,
    answers: parsed.data.answers,
    optIn: parsed.data.optIn,
    customerId: viewer?.customerId ?? null,
  });

  if (result.state === "not_found") {
    return NextResponse.json({ error: "Survey not found." }, { status: 404 });
  }
  if (result.state === "suppressed") {
    return NextResponse.json(
      { error: "You have already responded recently. Thank you." },
      { status: 429 },
    );
  }
  if (result.state === "invalid") {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(
    { ok: true, responseId: result.responseId, score: result.score },
    { headers: { "cache-control": "no-store" } },
  );
}
