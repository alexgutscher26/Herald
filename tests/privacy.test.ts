import { describe, expect, test } from "bun:test";

import {
  canPublishWithPrivacy,
  canViewPrivateContent,
  FEEDBACK_PRIVACY_LABELS,
  isFeedbackPrivacy,
  privacyRequiresCompany,
} from "@/features/feedback/privacy";

describe("feedback privacy", () => {
  test("accepts only the three documented audiences", () => {
    expect(isFeedbackPrivacy("public")).toBe(true);
    expect(isFeedbackPrivacy("author")).toBe(true);
    expect(isFeedbackPrivacy("company")).toBe(true);
    expect(isFeedbackPrivacy("everyone")).toBe(false);
    expect(isFeedbackPrivacy(null)).toBe(false);
  });

  test("only company-only publishing requires a company", () => {
    expect(privacyRequiresCompany("public")).toBe(false);
    expect(privacyRequiresCompany("author")).toBe(false);
    expect(privacyRequiresCompany("company")).toBe(true);
    expect(canPublishWithPrivacy("company", false)).toBe(false);
    expect(canPublishWithPrivacy("company", true)).toBe(true);
    expect(canPublishWithPrivacy("author", false)).toBe(true);
  });

  test("anonymous viewers only see public content", () => {
    expect(
      canViewPrivateContent({
        privacy: "public",
        authorCustomerId: "customer-1",
        viewerCustomerId: null,
        sharesCompany: false,
      }),
    ).toBe(true);

    for (const privacy of ["author", "company"] as const) {
      expect(
        canViewPrivateContent({
          privacy,
          authorCustomerId: "customer-1",
          viewerCustomerId: null,
          sharesCompany: false,
        }),
      ).toBe(false);
    }
  });

  test("an author sees their own row and company peers see company rows", () => {
    expect(
      canViewPrivateContent({
        privacy: "author",
        authorCustomerId: "customer-1",
        viewerCustomerId: "customer-1",
        sharesCompany: false,
      }),
    ).toBe(true);

    expect(
      canViewPrivateContent({
        privacy: "company",
        authorCustomerId: "customer-1",
        viewerCustomerId: "customer-2",
        sharesCompany: true,
      }),
    ).toBe(true);

    expect(
      canViewPrivateContent({
        privacy: "company",
        authorCustomerId: "customer-1",
        viewerCustomerId: "customer-2",
        sharesCompany: false,
      }),
    ).toBe(false);
  });

  test("an author-only row is not widened by a shared company", () => {
    expect(
      canViewPrivateContent({
        privacy: "author",
        authorCustomerId: "customer-1",
        viewerCustomerId: "customer-2",
        sharesCompany: true,
      }),
    ).toBe(false);
  });

  test("every audience has a display label", () => {
    expect(FEEDBACK_PRIVACY_LABELS.public).toBe("Public");
    expect(FEEDBACK_PRIVACY_LABELS.author).toBe("Only you");
    expect(FEEDBACK_PRIVACY_LABELS.company).toBe("Company only");
  });
});
