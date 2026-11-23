import { NextResponse, type NextRequest } from "next/server";

import {
  NO_STORE,
  jsonError,
  readCustomerSessionCookie,
} from "@/features/customer-session/http";
import { publicUnreadNotificationCount } from "@/features/notifications/inbox";
import { validateSlug } from "@/lib/slug";

/**
 * The widget launcher's badge source.
 *
 * The panel is server-rendered, so its count is only as fresh as its last
 * load. The iframe polls this route instead of reloading the whole page: the
 * customer comes from the session cookie, and the count is scoped by the
 * product that belongs to the workspace in the query. A signed-out visitor, an
 * unknown product and a session from another workspace all answer zero rather
 * than an error, because the badge is decoration and a failed poll is not a
 * broken page.
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const workspace = validateSlug(
    request.nextUrl.searchParams.get("workspaceSlug") ?? "",
  );
  const product = validateSlug(
    request.nextUrl.searchParams.get("productSlug") ?? "",
  );
  if (!workspace.ok || !product.ok) {
    return jsonError(400, "That inbox link is not valid.");
  }

  const unread = await publicUnreadNotificationCount({
    workspaceSlug: workspace.slug,
    productSlug: product.slug,
    sessionCookie: readCustomerSessionCookie(request),
  });

  return NextResponse.json({ unread }, { headers: NO_STORE });
}
