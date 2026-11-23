import "server-only";

import { and, eq, lte } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { apiIdempotencyKeys } from "@/db/schema";
import { getApiIdempotencyTtlMs } from "@/lib/env";
import { logEvent, serializeError } from "@/lib/logger";

import type { ApiAuth } from "./auth";
import { ApiFailure, apiJson } from "./http";
import { idempotencyRequestHash, isIdempotencyKeyShaped } from "./idempotency-core";

/**
 * `Idempotency-Key` handling.
 *
 * Contract:
 *  - the first successful-or-client-error response for a key is stored for the
 *    deployment's configured TTL (24 hours by default);
 *  - a retry with the same method, path and body replays that exact response
 *    and does not run the mutation again;
 *  - reusing the key for a different payload is a 422, not a silent replay;
 *  - a concurrent retry is a 409 with `Retry-After` while the first is running;
 *  - a 5xx is not stored, so the client can retry the work.
 *
 * The row is claimed with a unique insert before the handler runs, so two
 * simultaneous requests cannot both execute the write.
 */

export type IdempotentHandler = (bodyText: string) => Promise<NextResponse>;

function replay(
  responseBody: unknown,
  status: number,
  auth: ApiAuth,
): NextResponse {
  return apiJson(responseBody, {
    status,
    requestId: auth.requestId,
    headers: { "idempotency-replayed": "true" },
  });
}

export async function withIdempotency(input: {
  request: Request;
  auth: ApiAuth;
  endpoint: string;
  key: string | null;
  handler: IdempotentHandler;
}): Promise<NextResponse> {
  const bodyText = await input.request.text();
  const key = input.key;

  if (key === null) return input.handler(bodyText);

  if (!isIdempotencyKeyShaped(key)) {
    throw new ApiFailure(
      400,
      "invalid_request",
      "`Idempotency-Key` must be 8–255 characters of letters, digits, dot, colon, underscore or hyphen.",
    );
  }

  const requestHash = idempotencyRequestHash({
    method: input.request.method,
    path: new URL(input.request.url).pathname,
    bodyText,
  });

  const now = new Date();
  const expiresAt = new Date(now.getTime() + getApiIdempotencyTtlMs());

  const claimed = await db
    .insert(apiIdempotencyKeys)
    .values({
      workspaceId: input.auth.workspaceId,
      tokenId: input.auth.tokenId,
      key,
      endpoint: input.endpoint,
      requestHash,
      createdAt: now,
      expiresAt,
    })
    .onConflictDoNothing()
    .returning({ id: apiIdempotencyKeys.id });

  if (claimed[0]) {
    return runClaimed({
      rowId: claimed[0].id,
      bodyText,
      handler: input.handler,
      auth: input.auth,
    });
  }

  const existingRows = await db
    .select()
    .from(apiIdempotencyKeys)
    .where(
      and(
        eq(apiIdempotencyKeys.workspaceId, input.auth.workspaceId),
        eq(apiIdempotencyKeys.key, key),
      ),
    )
    .limit(1);

  const existing = existingRows[0];
  if (!existing) {
    // The row vanished between the insert and the read (expiry cleanup); treat
    // it as in progress instead of running an unclaimed mutation.
    throw inProgress();
  }

  if (existing.expiresAt.getTime() <= now.getTime()) {
    const takenOver = await db
      .update(apiIdempotencyKeys)
      .set({
        tokenId: input.auth.tokenId,
        endpoint: input.endpoint,
        requestHash,
        responseStatus: null,
        responseBody: null,
        createdAt: now,
        expiresAt,
      })
      .where(
        and(
          eq(apiIdempotencyKeys.id, existing.id),
          lte(apiIdempotencyKeys.expiresAt, now),
        ),
      )
      .returning({ id: apiIdempotencyKeys.id });

    if (!takenOver[0]) throw inProgress();
    return runClaimed({
      rowId: takenOver[0].id,
      bodyText,
      handler: input.handler,
      auth: input.auth,
    });
  }

  if (existing.requestHash !== requestHash || existing.endpoint !== input.endpoint) {
    throw new ApiFailure(
      422,
      "idempotency_key_reused",
      "This `Idempotency-Key` was already used for a different request.",
    );
  }

  if (existing.responseStatus === null) throw inProgress();

  return replay(existing.responseBody, existing.responseStatus, input.auth);
}

function inProgress(): ApiFailure {
  return new ApiFailure(
    409,
    "idempotency_in_progress",
    "A request with this `Idempotency-Key` is still being processed. Retry shortly.",
    { headers: { "retry-after": "1" } },
  );
}

async function runClaimed(input: {
  rowId: string;
  bodyText: string;
  handler: IdempotentHandler;
  auth: ApiAuth;
}): Promise<NextResponse> {
  let response: NextResponse;
  try {
    response = await input.handler(input.bodyText);
  } catch (error) {
    // Drop the claim so the same key can retry the work after a failure.
    await db
      .delete(apiIdempotencyKeys)
      .where(eq(apiIdempotencyKeys.id, input.rowId))
      .catch(() => {});
    throw error;
  }

  if (response.status >= 500) {
    await db
      .delete(apiIdempotencyKeys)
      .where(eq(apiIdempotencyKeys.id, input.rowId))
      .catch(() => {});
    return response;
  }

  const body = await response
    .clone()
    .json()
    .catch(() => null);

  try {
    await db
      .update(apiIdempotencyKeys)
      .set({ responseStatus: response.status, responseBody: body ?? null })
      .where(eq(apiIdempotencyKeys.id, input.rowId));
  } catch (error) {
    // The mutation already committed. Log it, but answer the first request
    // normally; only a later retry might run twice, and that is visible.
    logEvent("error", "api.idempotency_store_failed", {
      rowId: input.rowId,
      error: serializeError(error),
    });
  }

  const headers = new Headers(response.headers);
  headers.set("idempotency-replayed", "false");
  headers.set("cache-control", "private, no-store");
  headers.set("x-api-version", "1");
  headers.set("x-request-id", input.auth.requestId);

  return new NextResponse(response.body, {
    status: response.status,
    headers,
  });
}
