export const SUBSCRIBER_SOURCES = ["widget", "import", "api", "manual", "follower"] as const;
export type AudienceSource = (typeof SUBSCRIBER_SOURCES)[number];

export const SUPPRESSION_REASONS = [
  "hard_bounce",
  "complaint",
  "manual",
  "unsubscribe",
] as const;
export type AudienceSuppressionReason = (typeof SUPPRESSION_REASONS)[number];

export type AudienceRecipient = {
  email: string;
  name: string | null;
  source: AudienceSource;
  /** True when the address also follows a request linked to this release. */
  followsLinkedRequest: boolean;
};

export type AudienceSuppressedAddress = {
  email: string;
  reason: AudienceSuppressionReason;
  note: string | null;
};

/**
 * The pre-send answer: who gets the email, why they are in the audience, and
 * how many addresses would be skipped. Counts describe the whole product; the
 * lists are bounded previews.
 */
/** The explicit win-back match shown before a release is published. */
export type ReleaseWinbackPreview = {
  /** Cancellation reasons linked to the release. */
  reasons: number;
  /** Cancelled customers who recorded one of those reasons. */
  matched: number;
  /** Matched customers who pass every contactability rule right now. */
  eligible: number;
};

export type ReleaseAudiencePreview = {
  emailEnabled: boolean;
  totalSubscribers: number;
  eligible: number;
  /** Active, unsuppressed subscribers who muted one of this release's tags. */
  mutedByTag: number;
  /** Bounded preview; `eligible` carries the full count. */
  recipients: AudienceRecipient[];
  suppressed: number;
  suppressedByReason: Record<AudienceSuppressionReason, number>;
  /** Bounded preview; `suppressed` carries the full count. */
  suppressedAddresses: AudienceSuppressedAddress[];
  unsubscribed: number;
  pending: number;
  linkedRequestCount: number;
  /** Eligible recipients who also follow one of the linked requests. */
  followersInAudience: number;
};
