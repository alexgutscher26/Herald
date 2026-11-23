import type { NextRequest, NextResponse } from "next/server";

import { handleSsoIdentify } from "@/features/customer-auth/http";

/**
 * Widget identity handshake.
 *
 * The widget runs in an iframe on this origin, so it posts here rather than to
 * the host page's origin. Identity is only accepted as a signed JWT: there is
 * no unsigned identify path that could let a visitor claim another customer.
 */

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleSsoIdentify(request);
}
