import { NextResponse } from "next/server";

import {
  buildGlobalLlmsDocument,
  listPublicLlmsProducts,
} from "@/features/public/llms";
import { publicOrigin } from "@/features/public/urls";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const products = await listPublicLlmsProducts();
  return new NextResponse(
    buildGlobalLlmsDocument({ origin: publicOrigin(), products }),
    {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        // Privacy changes must be visible on the next crawl, not after a cache
        // window. The document is cheap and must never serve a hidden request.
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}
