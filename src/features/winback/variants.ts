/**
 * Deterministic A/B assignment for win-back recipients.
 *
 * The slice is keyed on the customer account id, so rebuilding the audience or
 * rebuilding a draft assigns the same person to the same variant. Anyone
 * outside the test slice receives variant A, and the rest of the slice is split
 * evenly. With `abTestPercent = 0` every recipient is A.
 */

export type WinbackVariant = "a" | "b";

export const AB_TEST_PERCENT_MIN = 5;
export const AB_TEST_PERCENT_MAX = 100;

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

export function assignVariant(
  customerAccountId: string,
  abTestPercent: number,
): WinbackVariant {
  const percent = Math.min(Math.max(Math.trunc(abTestPercent), 0), 100);
  if (percent === 0) return "a";

  const bucket = hash(customerAccountId) % 100;
  if (bucket >= percent) return "a";
  return bucket % 2 === 0 ? "a" : "b";
}

export function normalizeAbTestPercent(value: unknown): number {
  const parsed =
    typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(Math.max(Math.trunc(parsed), AB_TEST_PERCENT_MIN), AB_TEST_PERCENT_MAX);
}
