import { NextResponse, type NextRequest } from "next/server";

import { getProductLlmsDocument } from "@/features/public/llms";
import { publicOrigin } from "@/features/public/urls";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ workspaceSlug: string; productSlug: string }> },
): Promise<NextResponse> {
  const { workspaceSlug, productSlug } = await params;
  const document = await getProductLlmsDocument({
    workspaceSlug,
    productSlug,
    origin: publicOrigin(),
  });

  if (!document) {
    return new NextResponse("Not found\n", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }

  return new NextResponse(document, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
