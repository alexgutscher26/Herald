import { describe, expect, test } from "bun:test";

import { buildSignupFunnel } from "@/features/analytics/signup-funnel-model";

describe("signup funnel", () => {
  test("keeps the five stages in order and computes step rates", () => {
    const steps = buildSignupFunnel({
      sign_up_view: 400,
      account_created: 100,
      workspace_created: 80,
      first_release: 20,
      widget_installed: 6,
    });

    expect(steps.map((step) => step.stage)).toEqual([
      "sign_up_view",
      "account_created",
      "workspace_created",
      "first_release",
      "widget_installed",
    ]);
    expect(steps[0]?.rate).toBeNull();
    expect(steps[1]?.rate).toBeCloseTo(0.25);
    expect(steps[2]?.rate).toBeCloseTo(0.8);
    expect(steps[3]?.rate).toBeCloseTo(0.25);
    expect(steps[4]?.rate).toBeCloseTo(0.3);
  });

  test("a zero baseline does not produce a misleading rate", () => {
    const steps = buildSignupFunnel({
      sign_up_view: 0,
      account_created: 0,
      workspace_created: 3,
      first_release: 1,
      widget_installed: 0,
    });

    expect(steps[0]?.rate).toBeNull();
    expect(steps[1]?.rate).toBeNull();
    expect(steps[2]?.rate).toBeNull();
    expect(steps[4]?.rate).toBe(0);
  });

  test("negative or fractional counts cannot leak into the report", () => {
    const steps = buildSignupFunnel({
      sign_up_view: -4,
      account_created: 12.9,
      workspace_created: 0,
      first_release: 0,
      widget_installed: 0,
    });

    expect(steps[0]?.count).toBe(0);
    expect(steps[1]?.count).toBe(12);
  });
});
