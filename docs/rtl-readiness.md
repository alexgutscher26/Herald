# RTL readiness

No RTL locale ships today (`en` and `es` are both LTR), but the public portal is
built so adding one does not require a second layout.

## What is already in place

- The public shell sets both `lang` and `dir` from
  `PUBLIC_LOCALE_DIRECTIONS` in `src/features/public/i18n/index.ts`. Adding an
  RTL locale is one entry (`"rtl"`) plus its catalogue.
- Portal layout uses flex, grid, `max-w-*`, `gap` and `mx-auto` rather than
  fixed left/right positioning. The header search uses logical `ms-auto`.
- Directional navigation icons in board pagination, changelog filters and the
  request back link carry `rtl:rotate-180`.
- The public portal has no drawer or fixed side panel. Its header and mobile
  navigation are in normal flow, so there is no transform origin to mirror.
  Radix dialogs are centred and already direction-neutral.
- `dir` on the public wrapper, rather than `<html>`, is intentional: one
  deployment serves workspaces in different locales.

## What still needs a visual pass when an RTL locale ships

These are checks, not known defects. They cannot be marked done without a
browser in an RTL locale.

- Inspect board cards, request detail, pagination and the changelog timeline
  with `dir="rtl"`; confirm icon flips read correctly and no text is clipped.
- Inspect the public header at narrow widths; confirm the search field and
  viewer menu do not overlap.
- Inspect the consent banner and public dialogs; confirm they stay centred and
  their close controls remain reachable.
- Check long Spanish strings combined with RTL punctuation in ICU messages.
- Re-run the keyboard focus test after flipping the direction.

## Adding the first RTL locale

1. Add the locale to `PUBLIC_LOCALES` and its full catalogue to `MESSAGES`; the
   Spanish key-parity test will fail until every key exists.
2. Set its entry in `PUBLIC_LOCALE_DIRECTIONS` to `"rtl"`.
3. Flip any new directional icon with `rtl:rotate-180` and use logical spacing
   utilities (`ms-*`, `me-*`, `ps-*`, `pe-*`) rather than `ml-*`/`mr-*`.
4. Run the visual pass above in a browser before shipping.
