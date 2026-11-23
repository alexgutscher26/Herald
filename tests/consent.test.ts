import { describe, expect, test } from "bun:test";

import {
  CONSENT_VERSION,
  createConsentDecision,
  defaultPreferences,
  isRestrictedCountry,
  parseConsentCookie,
  restrictedFromLanguage,
  serializeConsentCookie,
} from "@/features/consent/core";

describe("consent jurisdiction", () => {
  test("recognises the EEA, UK and Switzerland", () => {
    for (const country of ["DE", "fr", "ES", "IE", "GB", "CH", "NO"]) {
      expect(isRestrictedCountry(country)).toBe(true);
    }
    expect(isRestrictedCountry("US")).toBe(false);
    expect(isRestrictedCountry(null)).toBe(false);
  });

  test("uses a region-qualified language as a fallback", () => {
    expect(restrictedFromLanguage("de-DE,de;q=0.9")).toBe(true);
    expect(restrictedFromLanguage("en-GB,en;q=0.9")).toBe(true);
    expect(restrictedFromLanguage("en-US,en;q=0.9")).toBe(false);
    expect(restrictedFromLanguage("en")).toBeNull();
    expect(restrictedFromLanguage(null)).toBeNull();
  });

  test("defaults optional storage off in restricted regions", () => {
    expect(defaultPreferences(true)).toEqual({ analytics: false, embeds: false });
    expect(defaultPreferences(false)).toEqual({ analytics: true, embeds: false });
  });
});

describe("consent cookie", () => {
  test("round-trips a decision", () => {
    const decision = createConsentDecision({ analytics: true, embeds: false });
    const parsed = parseConsentCookie(serializeConsentCookie(decision));

    expect(parsed).toEqual(decision);
    expect(parsed?.version).toBe(CONSENT_VERSION);
  });

  test("rejects a different version or malformed value", () => {
    const encoded = (value: unknown) => encodeURIComponent(JSON.stringify(value));

    expect(parseConsentCookie(encoded({ version: 2, analytics: true, embeds: true }))).toBeNull();
    expect(parseConsentCookie(encoded({ version: 1, analytics: "yes", embeds: true }))).toBeNull();
    expect(parseConsentCookie("not-json")).toBeNull();
    expect(parseConsentCookie(null)).toBeNull();
  });
});
