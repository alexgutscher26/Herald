# WCAG 2.2 AA audit: dashboard, portal forms and widget

- **Audit date:** 2026-11-21
- **Scope:** every signed-in dashboard area under `/app/{workspace}/{product}/...`,
  the public request and submit forms, the public notification inbox, and the
  widget launcher, panel, inbox and thread.
- **Standard:** WCAG 2.2 Level A and AA.
- **Method:** source and component audit against every A/AA success criterion;
  structural tests in `tests/dashboard-accessibility.test.ts` and
  `tests/accessibility-contrast.test.ts`; the seeded Chromium keyboard, focus,
  target-size and reduced-motion pass in `tests/e2e/accessibility.spec.ts`; the
  existing public audit in `docs/accessibility-audit.md`; and measured WCAG
  contrast calculations for the workspace accent system. This was **not** an
  independent audit and did not include an NVDA or VoiceOver run.

This document is the dashboard counterpart to the public audit. It records the
defects found, the source changes that address them, the checks that can be
repeated in CI, and the checks that still require a human, a browser or an
assisted-technology session. It does not claim WCAG conformance.

## Defects found and fixed

### 1.4.3 Contrast (Minimum) / 1.4.11 Non-text Contrast

The workspace accent was accepted as any six-digit hex and used directly as
`--primary` on both public themes. A pale accent could be unreadable as link
text on white, while a dark accent could disappear on the dark surface. The old
`foregroundFor()` used perceived luminance rather than the WCAG ratio and could
choose a foreground below 4.5:1 around mid grey.

`src/features/branding/schema.ts` now implements relative luminance, the WCAG
contrast ratio, a 4.5:1 text threshold, and an `accessibleOn()` derivation that
darkens or lightens the chosen accent until it clears the threshold on the
matching surface. The public layout supplies separate light and dark shades and
`src/app/globals.css` selects them for the light theme, the dark theme and
`prefers-color-scheme` auto mode. Button foregrounds use the higher-contrast of
black and white.

The settings screen reports the raw colour's ratio on each surface and explains
when an adjusted shade is used. `tests/accessibility-contrast.test.ts` checks ten
arbitrary colours, including white, black, pale yellow and magenta, on both
surfaces and for both foreground colours.

### 2.4.1 Bypass Blocks

The dashboard shell already had a "Skip to content" link and a focusable
`main#dashboard-content`. The audit verified that it is the first focusable
element, targets the main landmark, and expands visually on focus. This was a
confirmation rather than a new fix.

### 2.4.3 Focus Order / 2.4.7 Focus Visible

Client-side route changes previously left focus on the link that started the
navigation. `src/components/layout/route-focus.tsx` now moves focus to the new
page's `h1` (or the main landmark when a page has no heading) after a pathname
change. It deliberately ignores the first render and query-string-only updates,
so it does not steal focus on load or while a filter changes. The public
workspace layout mounts the same manager with `mainId="public-main"`, covering
board-to-request, changelog and portal navigation as well as the dashboard.

Dialogs and the mobile sheet use Radix Dialog, which contains focus while open
and returns it to the trigger on close. The command palette was the exception:
it can be opened from a global `Ctrl/⌘ K` shortcut and has no pointer trigger in
that path, so closing it left focus on `<body>`. It now explicitly restores the
trigger after the dialog's focus trap and `aria-hidden` cleanup finish. The
browser test opens it from the shortcut, checks that the search field is focused,
closes with Escape and with the `Ctrl/⌘ K` toggle, and asserts that the trigger
has focus after each. Dropdown, select and
alert-dialog focus behaviour is the same Radix primitive family and was reviewed
in source.

### 2.1.1 Keyboard / 2.5.7 Dragging Movements

The roadmap's pointer drag-and-drop is not the only way to change status. Every
card has a native `<select>` with the accessible name "Move {title} to another
status" and the board instructions attached through `aria-describedby`. The
status change is announced through the dashboard live region and also produces a
toast. The menu remains reachable when drag-and-drop is unavailable.

Other dashboard flows use native buttons, links, inputs and selects. Feedback
and inbox keyboard shortcuts (`j`/`k`/`x`/`/`/`?`) are additive; every action also
has a focusable control. The command palette and shortcut help are keyboard
openable.

The seeded Chromium pass activates the skip link, navigates to Feedback with the
keyboard, opens the command palette with `Ctrl K`, closes it with Escape, and
confirms the roadmap status menu is focusable, in the tab order and described by
`#roadmap-instructions`. This is a real keyboard run, not a source inference.

### 4.1.3 Status Messages / Live regions

`src/features/accessibility/live-announcer.tsx` provides one polite and one
assertive region for the dashboard. It is mounted by the app shell.

- The inbox compares the previous unread total and thread ids after a poll or
  SSE refresh and announces new conversations and unread customer messages.
- The conversation thread marks its message list as a `role="log"` with polite,
  addition-relevant announcements, so a new customer or teammate message is
  announced without moving focus.
- The roadmap announces the request and its new status after a move.
- The widget inbox compares unread totals on each poll and the thread uses a
  `role="log"`; new support replies are announced.
- Persistent status blocks (`role="status"`) remain for results, receipts and
  bulk-action undo. Toasts remain a visual convenience, not the only channel.

### 3.3.1 Error Identification / 3.3.2 Labels or Instructions

React Hook Form fields already receive `aria-invalid` and `aria-describedby`
through `FormControl`, and `FormMessage` uses `role="alert"`. Manual forms that
were not using that primitive were fixed:

- public submit: body, email, file and AI-rewrite errors;
- public identify and customer login: email errors;
- widget start and reply: labelled fields with the error region attached;
- subscriber add/suppress/import: field errors attached to the field;
- roadmap manager: the form error attached to the name input.

Fields keep visible labels or accessible names. Required/optional text and
constraints remain visible next to the field.

### 2.5.8 Target Size (Minimum)

The global stylesheet now enforces a 24 × 24 CSS px minimum for buttons,
role-button controls, summaries, selects and native checkboxes/radios at widths
up to 767 px. This sits beside the existing 24 px public language-switch target
and the 44 px preference for primary public actions. Inline text links are not
forced to a box and remain exempt, as WCAG allows. The Chromium pass measured
every visible control in the dashboard feedback page and public submit page at
360 px; there were no controls below 23.5 px in either run.

### 1.1.1 Non-text Content

Uploaded inline release images previously inserted Markdown immediately with an
alt string generated from the filename. The editor now stages every uploaded
image in `InlineImageAltDialog`, shows a preview and a prefilled suggestion, and
requires a non-empty alternative-text value before insertion. The value is
sanitised for Markdown and stored in the image reference. The release cover's
decorative preset art is `aria-hidden`; uploaded cover and social images remain
workspace-supplied content and need their own meaningful context.

### 2.2.2 Pause, Stop, Hide / 2.3.3 Animation from Interactions

`src/app/globals.css` now reduces animation, transition and smooth-scroll
durations to 0.01 ms when `prefers-reduced-motion: reduce` is set. The widget
already had the same override in `public/widget/v1.css`; that block was verified
and retained. A Chromium run with reduced motion emulated measured the dashboard
button transition/animation durations at 0.01 ms or less, `scroll-behavior:auto`,
and no animation or transition on the mounted widget launcher and panel. No
dashboard content depends on animation to understand state.

### Accessibility statement

`/accessibility` is published with the target, covered surfaces, checks, known
limitations and a contact address. It is linked from the trust navigation, the
marketing footer, the landing footer and the sitemap. The statement explicitly
says an independent NVDA/VoiceOver pass is not yet complete.

## Criterion review

The table records criteria that needed a source change, a confirmation, or a
residual manual check. Criteria not listed were reviewed in source and found
satisfied for the audited surfaces: language, page titles, headings, link
purpose, consistent navigation, no keyboard trap, no flashing content, pointer
cancellation, and status not conveyed by colour alone. "Source pass" means the
markup and logic are present; it is not a claim about a specific browser or
screen reader.

| Criterion | Status | Evidence / residual check |
| --- | --- | --- |
| 1.1.1 Non-text Content | Fixed / partial | Inline release images now require alt text. Decorative icons are `aria-hidden`; logos and screenshots have meaningful alt. Customer-uploaded public attachments still depend on the workspace. |
| 1.2.x Prerecorded media | Author-dependent | No dashboard-owned media player. Linked YouTube content depends on the uploader's captions. |
| 1.3.1 Info and Relationships | Source pass | One `h1` per page, section headings, labelled landmarks, table headers and captions on analytics/operations. |
| 1.3.2 Meaningful Sequence | Source pass | DOM order follows the visual order; the mobile sheet is a portal dialog. Browser reading-order check remains manual. |
| 1.3.4 Orientation | Source pass | No orientation lock. |
| 1.3.5 Identify Input Purpose | Source pass | Email, name and search fields use appropriate `type`, `name` and autocomplete where available. |
| 1.4.1 Use of Color | Source pass | Status/category badges include text; roadmap columns and inbox unread badges have text labels. Focus and selection states need a visual check. |
| 1.4.3 Contrast (Minimum) | Fixed | Accent contrast is now derived per theme and tested; dashboard tokens were reviewed against their surfaces. Measured values are in the contrast test. |
| 1.4.4 Resize Text (200%) | Not verified | Requires a browser pass. Layouts use relative sizes and wrap at narrow widths. |
| 1.4.10 Reflow (320 px) | Not verified | The shell collapses to the mobile sheet; tables use overflow containers. A 320 px/400% browser pass is still required. |
| 1.4.11 Non-text Contrast | Partial | Focus rings use the derived accent and borders use theme tokens. Chart marks, selected rows and button boundaries need runtime measurement. |
| 1.4.12 Text Spacing | Not verified | Requires the browser text-spacing override pass. |
| 1.4.13 Content on Hover or Focus | Not verified | Tooltips, dropdowns and the command palette need dismissable/hoverable/persistent checks in a browser. |
| 2.1.1 Keyboard | Verified (core) | Chromium keyboard run covers bypass, route navigation, command palette, dialog close and the roadmap status menu. Every dashboard route and every form still needs the manual walk listed below. |
| 2.1.2 No Keyboard Trap | Source pass | Radix dialogs contain focus intentionally and close on Escape; no competing trap was found. |
| 2.1.4 Character Key Shortcuts | Source pass | Shortcuts are single-key but can be ignored while typing and are documented in the shortcut help. |
| 2.2.1 Timing Adjustable | Source pass | No timed dashboard content. Auth magic-link expiry is a security control. |
| 2.2.2 Pause, Stop, Hide | Fixed | Global reduced-motion override plus the widget override; no essential auto-playing motion. |
| 2.3.1 Three Flashes | Source pass | No flashing content. |
| 2.3.3 Animation from Interactions | Fixed | Reduced-motion media query suppresses transitions and animations. |
| 2.4.1 Bypass Blocks | Verified | Chromium run makes the skip link the first Tab stop and moves focus to `main#dashboard-content`; structural test. |
| 2.4.2 Page Titled | Source pass | Route metadata supplies titles; the focused `h1` gives the destination name after client navigation. |
| 2.4.3 Focus Order | Fixed / verified (core) | Route focus manager moves focus to the new heading; Chromium run verifies it. Command palette and Radix dialogs restore focus. Manual tab-order walk through every route remains. |
| 2.4.4 Link Purpose | Source pass | Links use text or accessible names; icon-only controls have labels. |
| 2.4.5 Multiple Ways | Source pass | Sidebar, mobile navigation, breadcrumbs, command palette and direct URLs. |
| 2.4.6 Headings and Labels | Source pass | Page header renders one `h1`; section cards use `h2`/`h3`; form controls have labels or accessible names. |
| 2.4.7 Focus Visible | Source pass | Global `:focus-visible` outline; skip link and controls tested structurally. Contrast against every semantic surface still needs a visual check. |
| 2.4.11 Focus Not Obscured (Minimum) | Not verified | Sticky header, mobile bottom action bar and dialogs need a keyboard/zoom pass. |
| 2.5.3 Label in Name | Source pass | Visible labels match accessible names for the roadmap menu, filters, export, deletion and account controls. |
| 2.5.7 Dragging Movements | Fixed | Roadmap drag/drop has the per-card status menu alternative and announces the result. |
| 2.5.8 Target Size (Minimum) | Fixed / measured | 24 px minimum for mobile controls; Chromium measurement at 360 px found no dashboard or public submit control below the threshold. Inline links remain exempt. |
| 3.1.1 Language of Page | Source pass | Root document language; public wrapper follows the workspace locale. |
| 3.1.2 Language of Parts | Author-dependent | Customer-written content is not language-tagged. |
| 3.2.1 On Focus | Source pass | Focus does not trigger navigation or submission. |
| 3.2.2 On Input | Source pass | Filters update intentionally; destructive actions require explicit confirmation. |
| 3.2.3 Consistent Navigation | Source pass | Shared sidebar/mobile navigation and breadcrumbs. |
| 3.2.4 Consistent Identification | Source pass | Shared status badges, buttons and icons are used for the same actions. |
| 3.2.6 Consistent Help | Source pass | Help centre, support and account controls keep stable positions in the shell. |
| 3.3.1 Error Identification | Fixed | Field errors are text and use `role="alert"`; manual forms now link them with `aria-describedby`. |
| 3.3.2 Labels or Instructions | Fixed | Labels, constraints and image alt instructions are visible/programmatic. |
| 3.3.3 Error Suggestion | Partial | Validation messages describe correction; a full error-state walk through every form remains manual. |
| 3.3.4 Error Prevention (Legal, Financial, Data) | Source pass | Destructive workspace controls use confirmations; billing is outside this dashboard audit. |
| 3.3.7 Redundant Entry | Partial | Draft persistence and prefilled edit forms retain values; multi-step flows need a browser pass. |
| 3.3.8 Accessible Authentication | Source pass | Email magic link; no cognitive puzzle; paste is allowed. |
| 4.1.2 Name, Role, Value | Source pass | Native controls carry labels and state; custom Radix primitives expose roles and values. |
| 4.1.3 Status Messages | Fixed | Shared live regions for inbox unread, new messages, roadmap moves and async outcomes; persistent `role="status"` blocks retained. |

## Backlog traceability

| Backlog item | Evidence |
| --- | --- |
| Full dashboard audit | This document; `tests/dashboard-accessibility.test.ts` covers scope markers and core contracts; `tests/e2e/accessibility.spec.ts` exercises the core browser behaviours. |
| Keyboard-only dashboard flows | Native controls audited; Chromium keyboard run covers bypass, route navigation, command palette, dialog close and the roadmap status menu. Roadmap move announcement tested; full route-by-route walk remains below. |
| Screen-reader pass on request, submit, widget thread and inbox | Semantic fixes in `submit-form`, `identify-form`, `comment-form`, `thread-view`, `conversations-view` and `widget/messages-view`; **NVDA/VoiceOver run not executed**. |
| Route and dialog focus | `route-focus.tsx`; `command-palette.tsx`; Radix Dialog/Sheet restore protected and exercised in Chromium. |
| Live regions | `live-announcer.tsx`; inbox, thread, roadmap and widget changes. |
| Accent contrast | WCAG helpers in `branding/schema.ts`; theme overrides in `globals.css`; pure tests in `accessibility-contrast.test.ts`. |
| Reduced motion | Global media query plus `public/widget/v1.css`; measured in Chromium for dashboard and widget. |
| Form errors tied to inputs | Manual forms updated; public submit file error exercised in Chromium; React Hook Form already wires `FormControl`. |
| Dashboard skip link | Chromium run verifies first Tab stop and focus transfer to the main landmark. |
| 24 px mobile targets | Global mobile rule; Chromium measurement at 360 px found no violations. |
| Alt text prompt | `InlineImageAltDialog`; required before Markdown insertion. |
| Accessibility statement | `/accessibility` page, trust nav, marketing footer and sitemap. |

## Verification run

Recorded on 2026-11-21:

- `bun run typecheck` — passed.
- `bunx playwright test -c playwright.e2e.config.ts --project=e2e tests/e2e/accessibility.spec.ts`
  — 3 passed against the seeded disposable Postgres database and a real
  credential sign-in. Covers the dashboard keyboard/focus path, public labels
  and file-error association, 360 px target measurements, reduced motion, and
  the mounted widget launcher and panel.
- `bun test tests --path-ignore-patterns '**/integration/**'
  --path-ignore-patterns '**/browser/**' --path-ignore-patterns '**/e2e/**'`
  — 913 passed, 0 failed (4,971 assertions). The third ignore is required because
  Bun's directory runner otherwise tries to execute the Playwright spec files.
- `bunx eslint` on every touched source and test file — passed.
- `bun run build` — passed, including the bundle budget check.

The full unit suite and the Postgres integration suite are separate. The
integration suite could not run because the configured `DATABASE_URL` is not
loopback and `TEST_DATABASE_URL` was not provided; that is a database-test
limitation, not an accessibility result.

## Residual work before claiming conformance

A human reviewer still needs to run:

1. NVDA on Windows and VoiceOver on macOS through the public request page,
   submit form, widget thread, dashboard inbox and conversation thread. This is
   the one requested item that could not be performed in this environment.
2. Keyboard-only tab order through every dashboard route and every form,
   including the mobile navigation sheet, bulk actions and settings destructive
   controls. The Chromium pass covers the shell and the highest-risk flow, not
   every route.
3. Browser zoom at 200% and 400%, 320 px reflow, text-spacing overrides and
   focus-not-obscured checks with the sticky header and mobile action bar.
4. Visual focus/selection contrast on every semantic surface and chart mark.
5. Error, empty and loading states in every manual form, including the alt-text
   dialog when an image upload fails or is cancelled.

Until those are recorded, this is a completed source audit with automated
contracts, not an independent WCAG 2.2 AA certification.
