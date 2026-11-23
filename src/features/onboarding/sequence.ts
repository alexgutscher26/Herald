import {
  ONBOARDING_EMAIL_KINDS,
  type OnboardingEmailKind,
} from "@/db/schema/onboarding";

export const ONBOARDING_EMAIL_GAP_MS = 20 * 60 * 60 * 1000;

export type OnboardingMilestones = {
  hasWorkspace: boolean;
  hasPublishedRelease: boolean;
  hasWidgetInstall: boolean;
};

function reached(kind: OnboardingEmailKind, milestones: OnboardingMilestones): boolean {
  switch (kind) {
    case "welcome":
      return true;
    case "first_board":
      return milestones.hasWorkspace;
    case "first_release":
      return milestones.hasPublishedRelease;
    case "widget_installed":
      return milestones.hasWidgetInstall;
  }
}

/**
 * Pick the next onboarding email from observed facts.
 *
 * The sequence is intentionally paced: no second email within 20 hours, and a
 * step waits until its milestone exists. A user who never publishes a release
 * receives the first two tips only; nothing is sent for a milestone that did
 * not happen. The account preference and delivery ledger are checked by the
 * caller.
 */
export function nextOnboardingKind(input: {
  sent: readonly OnboardingEmailKind[];
  milestones: OnboardingMilestones;
  lastSentAt: Date | null;
  now: Date;
}): OnboardingEmailKind | null {
  if (
    input.lastSentAt &&
    input.now.getTime() - input.lastSentAt.getTime() < ONBOARDING_EMAIL_GAP_MS
  ) {
    return null;
  }

  const sent = new Set(input.sent);
  for (const kind of ONBOARDING_EMAIL_KINDS) {
    if (sent.has(kind)) continue;
    if (reached(kind, input.milestones)) return kind;
  }
  return null;
}
