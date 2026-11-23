import { z } from "zod";

import { recordWidgetInstalled } from "@/features/analytics/signup-funnel";
import { trackAnalyticsEvent } from "@/features/analytics/track";
import {
  consumeRateLimit,
  rateLimitKey,
} from "@/features/customer-session/rate-limit";
import { publicJson } from "@/features/public/actor";
import { parseWidgetHostOrigin } from "@/features/widget/paths";
import { resolveWidgetTenant } from "@/features/widget/service";

/**
 * Count a widget installation without asking the host page for a session.
 *
 * This is a deliberately narrow public counter: it resolves the same public,
 * plan-gated widget tenant as the iframe, accepts only `widget_install`, and
 * stores coarse installation metadata (loader version plus the exact host
 * origin) for the dashboard health panel. No page URL, visitor identity or
 * session is stored. It is rate limited separately from the install check so a
 * page reload cannot turn into an unbounded write.
 */

const bodySchema = z.object({
  workspaceSlug: z.string().min(1).max(80),
  productSlug: z.string().min(1).max(80),
  event: z.literal("widget_install"),
  origin: z.string().max(300).optional(),
  version: z.string().max(16).optional(),
});

export async function POST(request: Request): Promise<Response> {
  const limit = await consumeRateLimit({
    bucket: rateLimitKey(request, "public:widget-event"),
    limit: 60,
    windowSeconds: 60 * 60,
  });
  if (!limit.allowed) {
    return publicJson({ error: "Too many widget events." }, 429);
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return publicJson({ error: "Invalid widget event." }, 400);
  }

  const tenant = await resolveWidgetTenant({
    workspaceSlug: parsed.data.workspaceSlug,
    productSlug: parsed.data.productSlug,
  });
  if (!tenant) return publicJson({ error: "Not found." }, 404);

  const origin = parseWidgetHostOrigin(parsed.data.origin);
  const version =
    parsed.data.version && /^v[0-9]{1,2}$/.test(parsed.data.version)
      ? parsed.data.version
      : null;
  const metadata = {
    ...(origin ? { origin } : {}),
    ...(version ? { version } : {}),
  };

  await trackAnalyticsEvent({
    workspaceId: tenant.workspace.id,
    productId: tenant.product.id,
    type: "widget_install",
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  });
  await recordWidgetInstalled(tenant.product.id);

  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}
