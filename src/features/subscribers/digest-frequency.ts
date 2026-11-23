/** Digest cadence shared by preferences, queueing and the public form. */

export const DIGEST_FREQUENCIES = ["off", "daily", "weekly"] as const;
export type DigestFrequency = (typeof DIGEST_FREQUENCIES)[number];

export function isDigestFrequency(value: unknown): value is DigestFrequency {
  return typeof value === "string" && DIGEST_FREQUENCIES.includes(value as DigestFrequency);
}

/**
 * Read the effective cadence. `weeklyDigest` remains a compatibility mirror for
 * rows and integrations written before the cadence column existed.
 */
export function effectiveDigestFrequency(
  frequency: string | null | undefined,
  weeklyDigest: boolean,
): DigestFrequency {
  if (frequency === "daily" || frequency === "weekly") return frequency;
  if (frequency === "off") return weeklyDigest ? "weekly" : "off";
  return weeklyDigest ? "weekly" : "off";
}

export const DIGEST_FREQUENCY_LABELS: Record<DigestFrequency, string> = {
  off: "Off",
  daily: "Daily",
  weekly: "Weekly",
};
