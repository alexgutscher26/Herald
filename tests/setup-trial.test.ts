import { describe, expect, test } from "bun:test";

import {
  DEFAULT_TRIAL_DAYS,
  SETUP_COMPLETE_TRIAL_DAYS,
  trialDaysForSetup,
} from "@/features/billing/trial";

describe("setup trial offer", () => {
  test("uses the standard trial until setup is complete", () => {
    expect(DEFAULT_TRIAL_DAYS).toBe(14);
    expect(trialDaysForSetup(false)).toBe(14);
  });

  test("adds two weeks when the setup checklist is complete", () => {
    expect(SETUP_COMPLETE_TRIAL_DAYS).toBe(30);
    expect(trialDaysForSetup(true)).toBe(30);
  });
});
