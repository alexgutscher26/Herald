import { createHash } from "node:crypto";

/**
 * Pure `Idempotency-Key` rules.
 *
 * Split from the database-backed replay module so the key grammar and request
 * fingerprint can be unit-tested without a database or a request context.
 */

const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,255}$/;

export function isIdempotencyKeyShaped(value: unknown): value is string {
  return typeof value === "string" && KEY_PATTERN.test(value);
}

/** Fingerprint of everything that identifies "the same request". */
export function idempotencyRequestHash(input: {
  method: string;
  path: string;
  bodyText: string;
}): string {
  return createHash("sha256")
    .update(`${input.method.toUpperCase()}\n${input.path}\n${input.bodyText}`)
    .digest("hex");
}
