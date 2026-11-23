/**
 * Audience rules for feedback content, shared by the dashboard and the public
 * surface.
 *
 * This module is intentionally dependency-free: the public bundle may import
 * it without pulling in dashboard selectors, database clients or domain types.
 */

export type FeedbackPrivacy = "public" | "author" | "company";

export const FEEDBACK_PRIVACY_VALUES: readonly FeedbackPrivacy[] = [
  "public",
  "author",
  "company",
];

export function isFeedbackPrivacy(value: unknown): value is FeedbackPrivacy {
  return (
    typeof value === "string" &&
    FEEDBACK_PRIVACY_VALUES.includes(value as FeedbackPrivacy)
  );
}

/** Only a company-only row needs a company membership to publish. */
export function privacyRequiresCompany(privacy: FeedbackPrivacy): boolean {
  return privacy === "company";
}

/**
 * Whether a public author may choose this audience.
 *
 * Everyone can post publicly or to themselves; a company-only post needs at
 * least one company membership so the audience is never empty by accident.
 */
export function canPublishWithPrivacy(
  privacy: FeedbackPrivacy,
  hasCompanyMembership: boolean,
): boolean {
  return !privacyRequiresCompany(privacy) || hasCompanyMembership;
}

/** Short label used in badges; the dashboard and public surface share it. */
export const FEEDBACK_PRIVACY_LABELS: Record<FeedbackPrivacy, string> = {
  public: "Public",
  author: "Only you",
  company: "Company only",
};

/**
 * Whether the given viewer can read a row.
 *
 * This mirrors the SQL predicates and exists so the rule has one tested,
 * non-database representation. `sharesCompany` is resolved from live company
 * memberships by the caller.
 */
export function canViewPrivateContent(input: {
  privacy: FeedbackPrivacy;
  authorCustomerId: string | null;
  viewerCustomerId: string | null;
  sharesCompany: boolean;
}): boolean {
  if (input.privacy === "public") return true;
  if (input.viewerCustomerId === null) return false;
  if (input.authorCustomerId === null) return false;
  if (input.authorCustomerId === input.viewerCustomerId) return true;
  return input.privacy === "company" && input.sharesCompany;
}
