import { describe, expect, test } from "bun:test";

import {
  COMPLIANCE_STATEMENT,
  DPA_SECTIONS,
  RESIDENCY_FACTS,
  SECURITY_PRACTICES,
  SUBPROCESSORS,
} from "@/features/trust/content";

describe("trust pack", () => {
  test("publishes a sub-processor entry for every core provider with a purpose and location", () => {
    expect(SUBPROCESSORS.length).toBeGreaterThanOrEqual(4);
    for (const provider of SUBPROCESSORS) {
      expect(provider.name.length).toBeGreaterThan(2);
      expect(provider.purpose.length).toBeGreaterThan(10);
      expect(provider.dataCategories.length).toBeGreaterThan(10);
      expect(provider.location.length).toBeGreaterThan(2);
    }
    expect(SUBPROCESSORS.some((provider) => !provider.optional)).toBe(true);
  });

  test("does not claim a SOC 2 certification", () => {
    expect(COMPLIANCE_STATEMENT.soc2).toContain("does not currently hold a SOC 2 report");
    expect(COMPLIANCE_STATEMENT.soc2.toLowerCase()).toContain("does not claim");
    expect(COMPLIANCE_STATEMENT.soc2.toLowerCase()).not.toContain("soc 2 certified");
  });

  test("DPA covers the processor obligations a buyer checks for", () => {
    const titles = DPA_SECTIONS.map((section) => section.title.toLowerCase()).join(" ");
    for (const topic of [
      "scope",
      "instructions",
      "security",
      "sub-processors",
      "data-subject",
      "incidents",
      "transfers",
      "deletion",
      "audits",
    ]) {
      expect(titles).toContain(topic);
    }
    for (const section of DPA_SECTIONS) {
      expect(section.paragraphs.length).toBeGreaterThan(0);
    }
  });

  test("security and residency pages make concrete, non-empty statements", () => {
    expect(SECURITY_PRACTICES.length).toBeGreaterThanOrEqual(6);
    expect(RESIDENCY_FACTS.length).toBeGreaterThanOrEqual(4);
    for (const practice of SECURITY_PRACTICES) {
      expect(practice.body.length).toBeGreaterThan(40);
    }
    for (const fact of RESIDENCY_FACTS) {
      expect(fact.body.length).toBeGreaterThan(40);
    }
  });
});
