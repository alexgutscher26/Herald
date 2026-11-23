import { createHmac } from "node:crypto";

import { describe, expect, test } from "bun:test";

import {
  STRIPE_SIGNATURE_TOLERANCE_SECONDS,
  verifyStripeSignature,
} from "@/features/billing/signature";

function signature(payload: string, secret: string, timestamp: number): string {
  const value = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return `t=${timestamp},v1=${value}`;
}

describe("Stripe webhook signatures", () => {
  const secret = "whsec_test_secret";
  const payload = JSON.stringify({ id: "evt_1", type: "customer.subscription.updated" });
  const now = 1_800_000_000;

  test("accepts a current, correctly signed payload", () => {
    expect(
      verifyStripeSignature({
        header: signature(payload, secret, now),
        payload,
        secret,
        nowSeconds: now,
      }),
    ).toBe(true);
  });

  test("accepts one of several v1 signatures", () => {
    const good = signature(payload, secret, now).split("v1=")[1];
    expect(
      verifyStripeSignature({
        header: `t=${now},v1=${"0".repeat(64)},v1=${good}`,
        payload,
        secret,
        nowSeconds: now,
      }),
    ).toBe(true);
  });

  test("rejects tampering, the wrong secret and missing pieces", () => {
    expect(
      verifyStripeSignature({
        header: signature(payload, secret, now),
        payload: `${payload} `,
        secret,
        nowSeconds: now,
      }),
    ).toBe(false);
    expect(
      verifyStripeSignature({
        header: signature(payload, "whsec_wrong", now),
        payload,
        secret,
        nowSeconds: now,
      }),
    ).toBe(false);
    expect(verifyStripeSignature({ header: null, payload, secret, nowSeconds: now })).toBe(false);
    expect(
      verifyStripeSignature({ header: `t=${now}`, payload, secret, nowSeconds: now }),
    ).toBe(false);
  });

  test("rejects a replay outside the tolerance", () => {
    expect(
      verifyStripeSignature({
        header: signature(payload, secret, now),
        payload,
        secret,
        nowSeconds: now + STRIPE_SIGNATURE_TOLERANCE_SECONDS + 1,
      }),
    ).toBe(false);
  });
});
