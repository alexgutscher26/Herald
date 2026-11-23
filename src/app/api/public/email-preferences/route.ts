import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  NO_STORE,
  jsonError,
  rejectCrossOrigin,
} from "@/features/customer-session/http";
import {
  consumeRateLimit,
  rateLimitKey,
} from "@/features/customer-session/rate-limit";
import { DIGEST_FREQUENCIES } from "@/features/subscribers/digest-frequency";
import {
  parseQuietHours,
  type QuietHoursWindow,
} from "@/features/subscribers/quiet-hours";
import {
  getSubscriberPreferences,
  isPreferenceToken,
  updateSubscriberPreferences,
} from "@/features/subscribers/preferences";

/**
 * Public email preferences.
 *
 * The token in the request is the credential, so the endpoint needs no session.
 * It still rejects foreign origins and is rate-limited, because a token in a
 * URL can be submitted by a form on another site if the browser is tricked into
 * sending it.
 */

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  token: z.string().trim().min(32).max(128),
  productUpdates: z.boolean().optional(),
  winback: z.boolean().optional(),
  topics: z.record(z.string().min(1).max(32), z.boolean()).optional(),
  notifyStatusChanges: z.boolean().optional(),
  notifyReplies: z.boolean().optional(),
  digestFrequency: z.enum(DIGEST_FREQUENCIES).optional(),
  quietHours: z
    .object({
      start: z.string().trim().min(1).max(5),
      end: z.string().trim().min(1).max(5),
      timezone: z.string().trim().min(1).max(64),
    })
    .nullable()
    .optional(),
  weeklyDigest: z.boolean().optional(),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get("token")?.trim() ?? "";
  if (!isPreferenceToken(token)) {
    return jsonError(404, "That preferences link is not valid.");
  }

  const preferences = await getSubscriberPreferences(token);
  if (!preferences) {
    return jsonError(404, "That preferences link is not valid.");
  }

  return NextResponse.json({ preferences }, { headers: NO_STORE });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const limit = await consumeRateLimit({
    bucket: rateLimitKey(request, "email-preferences"),
    limit: 20,
    windowSeconds: 60,
  });
  if (!limit.allowed) {
    return jsonError(429, "Too many changes. Try again in a minute.");
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "That preferences link is not valid.");
  }

  const requestedQuietHours = parsed.data.quietHours;
  let quietHours: QuietHoursWindow | null | undefined;
  if (requestedQuietHours === undefined) {
    quietHours = undefined;
  } else if (requestedQuietHours === null) {
    quietHours = null;
  } else {
    const result = parseQuietHours(requestedQuietHours);
    if (!result.ok) return jsonError(400, result.error);
    quietHours = result.window;
  }

  const preferences = await updateSubscriberPreferences(parsed.data.token, {
    productUpdates: parsed.data.productUpdates,
    winback: parsed.data.winback,
    topics: parsed.data.topics,
    notifyStatusChanges: parsed.data.notifyStatusChanges,
    notifyReplies: parsed.data.notifyReplies,
    digestFrequency: parsed.data.digestFrequency,
    quietHours,
    weeklyDigest: parsed.data.weeklyDigest,
  });
  if (!preferences) {
    return jsonError(404, "That preferences link is not valid.");
  }

  return NextResponse.json({ preferences }, { headers: NO_STORE });
}
