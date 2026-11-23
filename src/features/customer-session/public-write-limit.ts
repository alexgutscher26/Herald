import "server-only";

import { NextResponse } from "next/server";

import { consumeRateLimit, rateLimitKey } from "./rate-limit";

/**
 * One gate for anonymous public writes.
 *
 * Every POST that a visitor can reach without a dashboard session goes through
 * this helper: conversations, replies, ratings, feedback cards, survey
 * responses, outbound events and experience events. The bucket is the hashed
 * client address (never the raw address), and the window is a fixed minute so
 * a caller that ignores `Retry-After` cannot keep a write loop alive.
 *
 * Each call site owns its limit because the cost differs: starting a thread is
 * far more expensive than dismissing an experience.
 */
export async function enforcePublicWriteLimit(
  request: Request,
  scope: string,
  limit: number,
  windowSeconds = 60,
): Promise<NextResponse | null> {
  const outcome = await consumeRateLimit({
    bucket: rateLimitKey(request, scope),
    limit,
    windowSeconds,
  });

  if (outcome.allowed) return null;

  return NextResponse.json(
    { error: "Too many requests. Try again shortly." },
    {
      status: 429,
      headers: {
        "retry-after": String(windowSeconds),
        "cache-control": "no-store",
      },
    },
  );
}
