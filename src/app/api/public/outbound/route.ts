import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { publicOutboundMessages, recordOutboundEvent } from "@/features/engagement/service";
import { rejectCrossOrigin } from "@/features/customer-session/http";
import { enforcePublicWriteLimit } from "@/features/customer-session/public-write-limit";
import { getPublicViewer } from "@/features/public/viewer";
import { getPublicSite } from "@/features/public/i18n/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const workspaceSlug = url.searchParams.get("workspaceSlug") ?? "";
  const productSlug = url.searchParams.get("productSlug") ?? "";
  if (!workspaceSlug || !productSlug) {
    return NextResponse.json({ error: "A workspace and product are required." }, { status: 400 });
  }
  const viewer = await getPublicViewer();
  const site = await getPublicSite(workspaceSlug);
  const messages = await publicOutboundMessages({
    workspaceSlug,
    productSlug,
    customerId: viewer?.customerId ?? null,
    locale: site.locale,
    context: {
      pageUrl: url.searchParams.get("pageUrl"),
      timeOnPage: Number(url.searchParams.get("timeOnPage") ?? 0) || 0,
      selectors: (url.searchParams.get("selectors") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    },
  });
  return NextResponse.json(
    {
      items: messages.map((message) => ({
        id: message.id,
        title: message.title,
        body: message.body,
        ctaLabel: message.ctaLabel,
        ctaUrl: message.ctaUrl,
      })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}

const eventSchema = z.object({
  workspaceSlug: z.string().min(1),
  productSlug: z.string().min(1),
  messageId: z.uuid(),
  type: z.enum(["opened", "clicked", "converted", "dismissed"]),
});

export async function POST(request: NextRequest) {
  const blocked = rejectCrossOrigin(request);
  if (blocked) return blocked;

  const limited = await enforcePublicWriteLimit(request, "public:outbound-event", 120);
  if (limited) return limited;

  const parsed = eventSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid event." }, { status: 400 });
  }
  const viewer = await getPublicViewer();
  const ok = await recordOutboundEvent({
    ...parsed.data,
    customerId: viewer?.customerId ?? null,
  });
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
