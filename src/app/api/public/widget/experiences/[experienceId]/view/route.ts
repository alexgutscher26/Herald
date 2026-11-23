import { NextResponse, type NextRequest } from "next/server";

import { recordExperienceView } from "@/features/engagement/service";
import { rejectCrossOrigin } from "@/features/customer-session/http";
import { enforcePublicWriteLimit } from "@/features/customer-session/public-write-limit";
import { getPublicViewer } from "@/features/public/viewer";

export const dynamic = "force-dynamic";

const COOKIE = "herald_experience_visitor";

/**
 * Count a banner or tour that the loader actually rendered.
 *
 * The loader posts through the iframe, so the write is same-origin and the
 * response can set the visitor cookie. The unique key (experience, visitor, UTC
 * day) makes a duplicate post harmless.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ experienceId: string }> },
) {
  const blocked = rejectCrossOrigin(request);
  if (blocked) return blocked;

  const limited = await enforcePublicWriteLimit(request, "public:experience-view", 120);
  if (limited) return limited;

  const { experienceId } = await params;
  const body = (await request.json().catch(() => null)) as
    | { workspaceSlug?: string; productSlug?: string; visitorKey?: string }
    | null;
  if (!body?.workspaceSlug || !body.productSlug) {
    return NextResponse.json(
      { error: "A workspace and product are required." },
      { status: 400 },
    );
  }

  const visitorKey =
    request.cookies.get(COOKIE)?.value || body.visitorKey || "";
  if (visitorKey.length < 8) {
    return NextResponse.json({ error: "Visitor key missing." }, { status: 400 });
  }

  const viewer = await getPublicViewer();
  const ok = await recordExperienceView({
    workspaceSlug: body.workspaceSlug,
    productSlug: body.productSlug,
    experienceId,
    visitorKey,
    customerId: viewer?.customerId ?? null,
  });
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
