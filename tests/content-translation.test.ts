import { describe, expect, test } from "bun:test";

import {
  normalizeHelpTranslations,
  normalizeOutboundTranslations,
  translatedHelp,
  translatedOutbound,
} from "@/features/i18n/content";

const help = {
  title: "Reset your password",
  body: "Open settings and choose reset.",
  translations: {
    es: {
      title: "Restablece tu contraseña",
      body: "Abre los ajustes y elige restablecer.",
    },
  },
};

const outbound = {
  title: "A new feature",
  body: "Try the new dashboard.",
  ctaLabel: "Open",
  translations: {
    es: {
      title: "Una función nueva",
      body: "Prueba el panel nuevo.",
      ctaLabel: "Abrir",
    },
  },
};

describe("content translations", () => {
  test("the workspace toggle off always serves the canonical copy", () => {
    expect(translatedHelp(help, "es", false)).toEqual({
      title: "Reset your password",
      body: "Open settings and choose reset.",
    });
    expect(translatedOutbound(outbound, "es", false)).toEqual({
      title: "A new feature",
      body: "Try the new dashboard.",
      ctaLabel: "Open",
    });
  });

  test("the workspace toggle on serves a complete Spanish variant", () => {
    expect(translatedHelp(help, "es", true)).toEqual({
      title: "Restablece tu contraseña",
      body: "Abre los ajustes y elige restablecer.",
    });
    expect(translatedOutbound(outbound, "es", true)).toEqual({
      title: "Una función nueva",
      body: "Prueba el panel nuevo.",
      ctaLabel: "Abrir",
    });
  });

  test("an untranslated article falls back to canonical copy", () => {
    expect(
      translatedHelp(
        { title: "Billing", body: "Billing help.", translations: {} },
        "es",
        true,
      ),
    ).toEqual({ title: "Billing", body: "Billing help." });
  });

  test("the default locale never replaces the canonical copy", () => {
    expect(translatedHelp(help, "en", true).title).toBe("Reset your password");
  });

  test("only supported, complete variants are stored", () => {
    expect(
      normalizeHelpTranslations({
        es: { title: "Solo título", body: "" },
        fr: { title: "Titre", body: "Corps" },
      }),
    ).toEqual({});
    expect(normalizeOutboundTranslations({ es: { title: "", body: "Cuerpo" } })).toEqual({});
  });
});
