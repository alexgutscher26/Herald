# ADR 0009: Localise the public portal, not the dashboard

- **Status:** Accepted
- **Date:** 2026-11-22
- **Applies to:** `src/features/public/i18n/`, `src/features/branding/schema.ts`,
  `src/features/help/service.ts`, `src/features/engagement/`,
  `docs/rtl-readiness.md`

## Context

Herald has two audiences. Workspace members run the dashboard and are a small,
known group. Customers visit a public portal that a workspace brands for its own
audience. Translating both at once would double the message surface and slow
every dashboard change for a benefit only the larger group needs.

Workspaces already choose a locale (English, Spanish or automatic browser
detection) in branding. Help articles and outbound messages accept
operator-authored translations. Customer content — request titles, comments,
conversation messages — is written by customers and must never be machine-
translated and presented as if it were theirs.

## Decision

1. **Public portal chrome is localised.** Every string the product owns on the
   public surface goes through the flat catalogue in
   `src/features/public/i18n/messages/{en,es}.ts`. The Spanish catalogue is
   typed key-for-key against English, so a missing key fails the build.
2. **Locale precedence is explicit visitor choice, then workspace setting, then
   `Accept-Language`, then English.** The workspace value may be `auto`, which
   is what makes browser detection observable. A fixed workspace locale still
   leaves the visitor a switch.
3. **The dashboard is English.** It has no message catalogue. Operator copy can
   change without a translation pass, and a half-translated dashboard is worse
   than a consistent one. Localising it is a separate project with its own
   catalogue and review.
4. **Content translations are operator-authored.** Help articles and outbound
   messages accept per-locale title/body variants. There is no machine
   translation in the product and no automatic fallback that invents text: an
   empty translation renders the canonical content.
5. **Customer content is never translated.** A request, comment or message is
   shown in the language it was written in. The product may label the locale;
   it does not rewrite the words.
6. **Layout is direction-ready, but only LTR ships.** `PUBLIC_LOCALE_DIRECTIONS`
   carries a direction per locale and the portal uses logical spacing and
   `rtl:rotate-180` on directional icons. Adding an RTL locale is one entry plus
   a catalogue, followed by the visual pass in
   [../rtl-readiness.md](../rtl-readiness.md).
7. **Widget UI follows the public catalogue.** The embed renders the same
   portal strings, so it inherits the visitor's locale instead of inventing a
   second translation layer. New panel controls must use the catalogue; an
   English-only control inside a Spanish widget is a bug.

## Consequences

- Adding a public locale requires a catalogue, a direction entry and a browser
  pass — not a dashboard translation.
- A new public string that bypasses the catalogue is a review finding. The
  typed catalogue makes the omission visible at compile time for the Spanish
  side, but only if the string is added to the catalogue at all.
- Dashboard users who do not read English are not served. That is a known
  limitation, recorded here so it is not mistaken for an oversight.
- Machine translation of customer content remains out of scope. A future
  feature could offer an opt-in translation with a visible label, but it must
  not replace the original text.
- RTL is not proven until a browser renders it. The CSS is ready; the visual
  checks are listed, not claimed.

## Verification

- `src/features/public/i18n/messages/es.ts` is typed as
  `Record<PublicMessageKey, string>`, so a missing or extra key is a type
  error.
- `docs/rtl-readiness.md` records the logical-property audit and the remaining
  visual checks.
- The public browser loop and the widget browser matrix render the English
  portal; a Spanish browser pass is a manual check when a catalogue changes.

Limit: no automated pseudo-localisation or string-extraction check runs over
the whole public surface. A hard-coded string in a client island can still
ship; the catalogue is a convention enforced by review, not by a lint rule.
