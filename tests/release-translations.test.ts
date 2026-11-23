import { describe, expect, test } from "bun:test";

import {
  normalizeReleaseTranslations,
  translatedRelease,
} from "@/features/i18n/content";

const BASE = {
  title: "Faster search",
  summary: "Search is faster.",
  body: "### What changed\n\nSearch is twice as fast.",
  translations: {
    es: {
      title: "Búsqueda más rápida",
      summary: "La búsqueda es más rápida.",
      body: "### Qué cambió\n\nLa búsqueda es el doble de rápida.",
    },
  },
};

describe("release translations", () => {
  test("keeps only complete locale entries", () => {
    expect(
      normalizeReleaseTranslations({
        es: { title: "Título", summary: "Resumen", body: "Cuerpo" },
        fr: { title: "Titre", summary: "Résumé", body: "Corps" },
      }),
    ).toEqual({ es: { title: "Título", summary: "Resumen", body: "Cuerpo" } });

    expect(
      normalizeReleaseTranslations({
        es: { title: "Título", summary: "", body: "Cuerpo" },
      }),
    ).toEqual({});
  });

  test("trims and caps translated fields", () => {
    const normalized = normalizeReleaseTranslations({
      es: {
        title: `  ${"a".repeat(130)}  `,
        summary: "  Resumen  ",
        body: "  Cuerpo  ",
      },
    });
    expect(normalized.es?.title).toHaveLength(120);
    expect(normalized.es?.summary).toBe("Resumen");
    expect(normalized.es?.body).toBe("Cuerpo");
  });

  test("selects the visitor locale only when content translation is enabled", () => {
    expect(translatedRelease(BASE, "es", true)).toEqual(BASE.translations.es);
    expect(translatedRelease(BASE, "es", false)).toEqual({
      title: BASE.title,
      summary: BASE.summary,
      body: BASE.body,
    });
    expect(translatedRelease(BASE, "en", true)).toEqual({
      title: BASE.title,
      summary: BASE.summary,
      body: BASE.body,
    });
  });

  test("falls back to the canonical copy when a locale is missing", () => {
    expect(translatedRelease({ ...BASE, translations: {} }, "es", true)).toEqual({
      title: BASE.title,
      summary: BASE.summary,
      body: BASE.body,
    });
  });
});