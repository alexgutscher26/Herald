import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/lib/auth";

/**
 * Better Auth catch-all route (`/api/auth/*`).
 *
 * The handler is resolved lazily inside each request so that importing this
 * module during `next build` never reads environment configuration.
 */
function handler() {
  return toNextJsHandler(getAuth().handler);
}

export async function GET(request: Request): Promise<Response> {
  return handler().GET(request);
}

export async function POST(request: Request): Promise<Response> {
  return handler().POST(request);
}