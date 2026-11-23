import { NextResponse, type NextRequest } from "next/server";

import {
  publicExperiences,
  publicSurveyPrompts,
} from "@/features/engagement/service";
import { getPublicViewer } from "@/features/public/viewer";

export const dynamic = "force-dynamic";

const COOKIE = "herald_experience_visitor";

/**
 * Proactive surfaces: tours, banners and plan-limited survey prompts.
 *
 * The loader evaluates page, time, selector and event rules itself because
 * only the browser knows them; attribute targeting and the impression cap are
 * decided here. Survey prompts are appended after experiences so an existing
 * banner keeps the slot it had.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const workspaceSlug = url.searchParams.get("workspaceSlug") ?? "";
  const productSlug = url.searchParams.get("productSlug") ?? "";
  if (!workspaceSlug || !productSlug) {
    return NextResponse.json({ error: "A workspace and product are required." }, { status: 400 });
  }

  const existing = request.cookies.get(COOKIE)?.value;
  const visitorKey =
    existing && existing.length >= 8 ? existing : crypto.randomUUID();
  const viewer = await getPublicViewer();
  const previewToken = url.searchParams.get("preview") ?? "";

  const [items, prompts] = await Promise.all([
    publicExperiences({
      workspaceSlug,
      productSlug,
      visitorKey,
      customerId: viewer?.customerId ?? null,
      previewToken: previewToken || null,
    }),
    previewToken
      ? Promise.resolve([])
      : publicSurveyPrompts({
          workspaceSlug,
          productSlug,
          visitorKey,
          customerId: viewer?.customerId ?? null,
        }),
  ]);

  const response = NextResponse.json(
    { items: [...items, ...prompts], visitorKey },
    { headers: { "cache-control": "no-store" } },
  );
  if (!existing) {
    response.cookies.set(COOKIE, visitorKey, {
      httpOnly: true,
      sameSite: "lax",
      secure: url.protocol === "https:",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return response;
}
