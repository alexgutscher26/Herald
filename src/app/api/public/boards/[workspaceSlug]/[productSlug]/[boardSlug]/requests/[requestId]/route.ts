import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getPublicRequestPage } from "@/features/public/queries";
import { getPublicViewer } from "@/features/public/viewer";

/**
 * Public request projection.
 *
 * The request id is looked up *inside* the resolved board, so guessing a UUID
 * from another product or workspace cannot return it. Invalid ids are treated
 * as not found rather than as a separate error.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;
const uuidSchema = z.uuid();

export async function GET(
  _request: NextRequest,
  context: {
    params: Promise<{
      workspaceSlug: string;
      productSlug: string;
      boardSlug: string;
      requestId: string;
    }>;
  },
): Promise<NextResponse> {
  const params = await context.params;
  if (!uuidSchema.safeParse(params.requestId).success) {
    return NextResponse.json({ error: "Request not found." }, { status: 404, headers: NO_STORE });
  }

  const viewer = await getPublicViewer();
  const page = await getPublicRequestPage(
    {
      workspaceSlug: params.workspaceSlug,
      productSlug: params.productSlug,
      boardSlug: params.boardSlug,
      requestId: params.requestId,
    },
    viewer,
  );

  if (!page) {
    return NextResponse.json({ error: "Request not found." }, { status: 404, headers: NO_STORE });
  }

  return NextResponse.json(page, { headers: NO_STORE });
}
