import type { NextRequest, NextResponse } from "next/server";

import { handleSsoIdentify } from "@/features/customer-auth/http";

/**
 * Establish a customer session from a server-signed identity token.
 *
 * This is the handoff the widget uses: the host app mints a short-lived JWT
 * with the workspace's SSO secret, the widget posts it here, and the public
 * pages on this origin are signed in on the next request.
 */

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleSsoIdentify(request);
}
