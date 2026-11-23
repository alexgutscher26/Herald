# Timezone display policy

**Decided:** 2026-11-21

## Rules

1. **Storage is UTC.** Every timestamp column is `timestamptz`; the database
   stores an instant, never a wall-clock string.
2. **The workspace timezone is authoritative.** Scheduling, reporting windows,
   email send times and operator availability use `workspaces.timezone` (IANA,
   for example `America/New_York`).
3. **Every displayed instant is labelled.** The workspace time comes first with
   its abbreviation, followed by the viewer's resolved zone when it differs:
   `Nov 21, 2026, 2:30 PM ET (workspace) · 8:30 PM CET (your time)`.
4. **The viewer's zone is resolved in the browser.** `Intl.DateTimeFormat()
   .resolvedOptions().timeZone` is read in an effect so server HTML and the
   first client render match; the viewer's time is appended after hydration.
5. **Inputs are workspace time.** `<input type="datetime-local">` values are
   converted with `zonedInputToIso` / `isoToZonedInput` and the surrounding
   label states the zone, e.g. `Timezone: ET (America/New_York)`.
6. **Emails use the workspace zone with its label.** A recipient in another
   zone can still read the instant unambiguously.

## Implementation

- `src/lib/format.ts` — `formatDate`, `formatDateTime`, `formatMoney`,
  `formatCurrency`, `timeZoneAbbreviation`, and the zoned-input helpers.
- `src/components/shared/dual-timestamp.tsx` — `DualTimestamp` and
  `ViewerTimeZone`. Use these instead of calling `Intl` directly in a view.
- Applied on the feedback detail, the inbox list and thread, and the release
  editor, with a viewer-zone label on the releases and overview headers. New
  timestamp surfaces should use the same components.

## What not to do

- Do not render a bare `new Date(iso).toLocaleString()`; it uses the runtime's
  zone and produces different output on the server and the client.
- Do not show UTC as if it were the workspace zone.
- Do not silently convert a schedule; show the zone next to the value.
