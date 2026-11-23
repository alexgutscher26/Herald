import { describe, expect, test } from "bun:test";

import {
  ONBOARDING_EMAIL_GAP_MS,
  nextOnboardingKind,
} from "@/features/onboarding/sequence";

const NOW = new Date("2026-11-21T12:00:00Z");
const OLD_ENOUGH = new Date(NOW.getTime() - ONBOARDING_EMAIL_GAP_MS - 1);

describe("onboarding email sequence", () => {
  test("sends welcome first, then only the milestones that exist", () => {
    expect(
      nextOnboardingKind({
        sent: [],
        milestones: {
          hasWorkspace: false,
          hasPublishedRelease: false,
          hasWidgetInstall: false,
        },
        lastSentAt: null,
        now: NOW,
      }),
    ).toBe("welcome");

    expect(
      nextOnboardingKind({
        sent: ["welcome"],
        milestones: {
          hasWorkspace: true,
          hasPublishedRelease: false,
          hasWidgetInstall: false,
        },
        lastSentAt: OLD_ENOUGH,
        now: NOW,
      }),
    ).toBe("first_board");

    expect(
      nextOnboardingKind({
        sent: ["welcome", "first_board"],
        milestones: {
          hasWorkspace: true,
          hasPublishedRelease: true,
          hasWidgetInstall: false,
        },
        lastSentAt: OLD_ENOUGH,
        now: NOW,
      }),
    ).toBe("first_release");
  });

  test("waits for the next milestone instead of inventing one", () => {
    expect(
      nextOnboardingKind({
        sent: ["welcome", "first_board"],
        milestones: {
          hasWorkspace: true,
          hasPublishedRelease: false,
          hasWidgetInstall: true,
        },
        lastSentAt: OLD_ENOUGH,
        now: NOW,
      }),
    ).toBe("widget_installed");
  });

  test("paces emails by at least 20 hours", () => {
    expect(
      nextOnboardingKind({
        sent: ["welcome"],
        milestones: {
          hasWorkspace: true,
          hasPublishedRelease: true,
          hasWidgetInstall: true,
        },
        lastSentAt: new Date(NOW.getTime() - 60 * 60 * 1000),
        now: NOW,
      }),
    ).toBeNull();
  });

  test("returns null when every reached step was already sent", () => {
    expect(
      nextOnboardingKind({
        sent: ["welcome", "first_board", "first_release", "widget_installed"],
        milestones: {
          hasWorkspace: true,
          hasPublishedRelease: true,
          hasWidgetInstall: true,
        },
        lastSentAt: OLD_ENOUGH,
        now: NOW,
      }),
    ).toBeNull();
  });
});
