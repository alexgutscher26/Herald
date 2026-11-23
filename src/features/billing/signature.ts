import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify a Stripe webhook signature over the raw request body.
 *
 * Stripe sends `t=<unix>,v1=<hex>[,v1=<hex>]`. The HMAC covers the timestamp,
 * a dot and the exact bytes received, so a JSON re-serialisation is not
 * equivalent. A five-minute tolerance limits replay.
 */

export const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;

export function verifyStripeSignature(input: {
  header: string | null;
  payload: string;
  secret: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): boolean {
  if (!input.header || input.secret.length === 0) return false;

  const parts = input.header.split(",").map((part) => part.trim());
  let timestamp: number | null = null;
  const signatures: string[] = [];

  for (const part of parts) {
    const [key, value] = part.split("=", 2);
    if (key === "t" && value) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) timestamp = parsed;
    } else if (key === "v1" && value) {
      signatures.push(value);
    }
  }

  if (timestamp === null || signatures.length === 0) return false;

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? STRIPE_SIGNATURE_TOLERANCE_SECONDS;
  if (Math.abs(now - timestamp) > tolerance) return false;

  const expected = createHmac("sha256", input.secret)
    .update(`${timestamp}.${input.payload}`)
    .digest();
  const expectedBuffer = Buffer.from(expected);

  return signatures.some((signature) => {
    if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
    const provided = Buffer.from(signature, "hex");
    return provided.length === expectedBuffer.length && timingSafeEqual(provided, expectedBuffer);
  });
}
