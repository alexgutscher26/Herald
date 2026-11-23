import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { getCronSecret } from "@/lib/env";

/**
 * Shared cron authorization.
 *
 * Both scheduled endpoints stay closed unless `CRON_SECRET` is configured.
 * The secret is compared in constant time and is never echoed in a response.
 */

export const CRON_NO_STORE = { "cache-control": "no-store" } as const;

export function cronJson(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: CRON_NO_STORE });
}

function readToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(header);
  if (bearer) return bearer[1]!.trim();
  return (request.headers.get("x-cron-secret") ?? "").trim();
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Returns a ready-to-return error response, or `null` when authorized. */
export function cronAuthError(request: Request): NextResponse | null {
  let secret: string | null;
  try {
    secret = getCronSecret();
  } catch {
    return cronJson(
      { ok: false, error: "Scheduled jobs are not configured correctly." },
      503,
    );
  }

  if (!secret) {
    return cronJson(
      { ok: false, error: "Scheduled jobs are not configured. Set CRON_SECRET." },
      503,
    );
  }

  if (!constantTimeEquals(readToken(request), secret)) {
    return cronJson({ ok: false, error: "Unauthorized." }, 401);
  }

  return null;
}
