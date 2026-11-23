import { NextResponse } from "next/server";

import { openApiDocument } from "@/features/api-v1/openapi";

/**
 * The API description is deliberately public: it documents the surface, not
 * the data, and a client generator needs it before it has a token.
 */

export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(openApiDocument, {
    headers: {
      "cache-control": "public, max-age=300",
      "content-type": "application/json; charset=utf-8",
    },
  });
}
