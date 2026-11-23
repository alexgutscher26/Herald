import type { NextRequest } from "next/server";

import { publicJson } from "@/features/public/actor";
import { PUBLIC_BOARD_MAX_SEARCH_LENGTH } from "@/features/public/query";
import { suggestPublicRequests } from "@/features/public/queries";

/**
 * Duplicate suggestions while typing a title.
 *
 * Read-only and cheap to call: an empty or too-short query returns nothing
 * rather than every request on the product.
 */

export const dynamic = "force-dynamic";

type Params = {
  workspaceSlug: string;
  productSlug: string;
  boardSlug: string;
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<Params> },
): Promise<Response> {
  const params = await context.params;
  const query = (new URL(request.url).searchParams.get("q") ?? "")
    .trim()
    .slice(0, PUBLIC_BOARD_MAX_SEARCH_LENGTH);

  if (query.length < 3) return publicJson({ suggestions: [] });

  const suggestions = await suggestPublicRequests(params, query);
  if (!suggestions) return publicJson({ error: "Board not found." }, 404);

  return publicJson({ suggestions });
}
