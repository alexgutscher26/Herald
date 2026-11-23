import { describe, expect, test } from "bun:test";

import { foregroundFor, isBrandColor } from "@/features/branding/schema";
import {
  MESSAGES,
  PUBLIC_LOCALE_DIRECTIONS,
  createTranslator,
  detectLocale,
  formatPublicDate,
  formatPublicMessage,
  formatPublicNumber,
  localeSwitchPath,
  resolvePublicLocale,
  safePublicNext,
} from "@/features/public/i18n";
import { formatPlannedFor } from "@/features/public/format";
import { en } from "@/features/public/i18n/messages/en";
import { es } from "@/features/public/i18n/messages/es";

/**
 * Locale precedence and branding validation are pure functions, and they decide
 * what every public visitor sees before any page renders.
 */

describe("locale detection", () => {
  test("picks the highest-priority supported Accept-Language tag", () => {
    expect(detectLocale("es-MX,es;q=0.9,en;q=0.8")).toBe("es");
    expect(detectLocale("fr-FR,fr;q=0.9,es;q=0.4")).toBe("es");
    expect(detectLocale("en-GB,en;q=0.9")).toBe("en");
    expect(detectLocale("*")).toBe("en");
    expect(detectLocale(null)).toBe("en");
  });

  test("ignores unsupported and zero-quality entries", () => {
    expect(detectLocale("fr;q=0.9,de;q=0.8")).toBe("en");
    expect(detectLocale("es;q=0,en;q=0.1")).toBe("en");
  });

  test("visitor cookie wins, then the workspace setting, then the browser", () => {
    expect(
      resolvePublicLocale({ configured: "es", cookie: "en", acceptLanguage: "es-ES" }),
    ).toBe("en");
    expect(
      resolvePublicLocale({ configured: "es", cookie: null, acceptLanguage: "en-US" }),
    ).toBe("es");
    expect(
      resolvePublicLocale({ configured: "auto", cookie: null, acceptLanguage: "es-ES" }),
    ).toBe("es");
    expect(
      resolvePublicLocale({ configured: "auto", cookie: "de", acceptLanguage: "es-ES" }),
    ).toBe("es");
  });

  test("an explicit alternate URL wins over a stored cookie", () => {
    expect(
      resolvePublicLocale({
        configured: "es",
        cookie: "es",
        acceptLanguage: "es-ES",
        explicit: "en",
      }),
    ).toBe("en");
    expect(
      resolvePublicLocale({
        configured: "es",
        cookie: "en",
        acceptLanguage: "en-US",
        explicit: "de",
      }),
    ).toBe("en");
  });
});

describe("public copy", () => {
  test("every English catalogue key has a Spanish entry", () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(MESSAGES.es).sort()).toEqual(Object.keys(MESSAGES.en).sort());
  });

  test("ships a direction for every locale", () => {
    expect(PUBLIC_LOCALE_DIRECTIONS).toEqual({ en: "ltr", es: "ltr" });
  });

  test("translates and interpolates in both languages", () => {
    const english = createTranslator("en");
    const spanish = createTranslator("es");

    expect(english.t("board.requestCount.other", { count: 4 })).toBe("4 requests");
    expect(spanish.t("board.requestCount.other", { count: 4 })).toBe("4 solicitudes");
    expect(english.tc("common.voteCount.one", "common.voteCount.other", 1)).toBe(
      "1 vote",
    );
    expect(spanish.tc("common.voteCount.one", "common.voteCount.other", 2)).toBe(
      "2 votos",
    );
  });

  test("formats ICU plurals instead of concatenating strings", () => {
    const english = createTranslator("en");
    const spanish = createTranslator("es");

    expect(english.t("search.resultCount", { count: 1 })).toBe("1 result");
    expect(english.t("search.resultCount", { count: 2 })).toBe("2 results");
    expect(spanish.t("search.resultCount", { count: 1 })).toBe("1 resultado");
    expect(spanish.t("search.resultCount", { count: 2 })).toBe("2 resultados");
    expect(english.tc("common.voteCount.one", "common.voteCount.other", 3)).toBe("3 votes");
  });

  test("formats numbers with the active locale", () => {
    expect(formatPublicNumber("en", 1234)).toBe("1,234");
    expect(formatPublicMessage("en", "{count} items", { count: 1234 })).toBe("1,234 items");
    expect(formatPublicMessage("en", "{count, plural, one {# item} other {# items}}", {
      count: 1200,
    })).toBe("1,200 items");
  });

  test("formats dates with the active locale", () => {
    expect(formatPublicDate("en", "2024-02-03T00:00:00.000Z")).toContain("2024");
    expect(formatPublicDate("es", new Date("2024-02-03T00:00:00.000Z"))).toContain("2024");
    expect(formatPublicDate("es", "not a date")).toBe("");
  });

  test("formats a planned target date with the active locale", () => {
    expect(formatPlannedFor("en", "2027-03-31")).toBe("Mar 31, 2027");
    expect(formatPlannedFor("es", "2027-03-31")).not.toBe("Mar 31, 2027");
    expect(formatPlannedFor("es", "2027-03-31")).toContain("2027");
    expect(formatPlannedFor("es", "2027-Q1")).toBe("Q1 2027");
  });

  test("only returns to a path inside the public site", () => {
    expect(safePublicNext("/p/acme/app/feedback")).toBe("/p/acme/app/feedback");
    expect(safePublicNext("https://evil.test/p/acme")).toBe("/");
    expect(safePublicNext("//evil.test/p/acme")).toBe("/");
    expect(safePublicNext("/\\evil.test")).toBe("/");
    expect(safePublicNext("/app/acme/settings")).toBe("/");
    expect(safePublicNext(null)).toBe("/");

    expect(localeSwitchPath("es", "/p/acme/app/feedback")).toBe(
      "/api/public/locale?locale=es&next=%2Fp%2Facme%2Fapp%2Ffeedback",
    );
  });
});

describe("branding values", () => {
  test("accepts only six-digit hex colours", () => {
    expect(isBrandColor("#4f46e5")).toBe(true);
    expect(isBrandColor("#4F46E5")).toBe(false);
    expect(isBrandColor("rebeccapurple")).toBe(false);
    expect(isBrandColor("url(javascript:alert(1))")).toBe(false);
    expect(foregroundFor("#ffffff")).toBe("#111111");
    expect(foregroundFor("#000000")).toBe("#ffffff");
    expect(foregroundFor("not-a-colour")).toBe("#ffffff");
  });
});
