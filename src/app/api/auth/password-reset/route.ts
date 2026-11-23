import { NextResponse } from "next/server";
import { z } from "zod";

import { completePasswordReset } from "@/features/auth/password-reset";
import {
  consumeRateLimit,
  rateLimitKey,
} from "@/features/customer-session/rate-limit";
import { isSameOriginRequest } from "@/features/customer-session/origin";
import { publicOrigin } from "@/features/public/urls";
import { reportError } from "@/lib/error-report";
import { attachRequestId, requestIdFor } from "@/lib/request-context";

/**
 * Complete a password reset with the emailed token.
 *
 * A sibling of Better Auth's catch-all route: the token is spent here and handed
 * to `auth.api.resetPassword`, so the emailed token is stored hashed (see
 * `src/features/auth/reset-token-store.ts`). The endpoint is same-origin only,
 * rate limited, and answers with one generic message per failure so it cannot be
 * used to learn whether a token ever existed.
 */

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  token: z.string().min(16).max(200),
  password: z.string().min(1).max(200),
});

function json(payload: Record<string, unknown>, status: number, requestId: string) {
  return attachRequestId(
    NextResponse.json(payload, {
      status,
      headers: { "cache-control": "no-store" },
    }),
    requestId,
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = requestIdFor(request);

  const sameOrigin = isSameOriginRequest({
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
    expectedOrigin: publicOrigin(),
  });
  if (!sameOrigin) {
    return json({ ok: false, error: "This request was rejected." }, 403, requestId);
  }

  const limit = await consumeRateLimit({
    bucket: rateLimitKey(request, "auth:password-reset"),
    limit: 10,
    windowSeconds: 60,
  });
  if (!limit.allowed) {
    return json(
      { ok: false, error: "Too many attempts. Wait a minute and try again." },
      429,
      requestId,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "This link is incomplete." }, 400, requestId);
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: "This link is incomplete." }, 400, requestId);
  }

  try {
    const outcome = await completePasswordReset({
      token: parsed.data.token,
      newPassword: parsed.data.password,
    });
    if (!outcome.ok) {
      return json({ ok: false, error: outcome.error }, 400, requestId);
    }
    return json({ ok: true }, 200, requestId);
  } catch (error) {
    await reportError(error, { requestId, route: "/api/auth/password-reset" }, "auth.password_reset.failed");
    return json(
      { ok: false, error: "Could not change the password. Please try again." },
      500,
      requestId,
    );
  }
}
