# WCAG 2.2 AA audit: public surface

- **Audit date:** 2026-11-21
- **Scope:** marketing, pricing, comparison, demo, status, trust/legal, public
  workspace pages (`/p/{workspace}/{product}/...`), public search, public 404,
  and the consent and embed components used on those pages.
- **Standard:** WCAG 2.2 Level A and AA.
- **Method:** source and component audit against every A/AA success criterion,
  structural tests in `tests/public-accessibility.test.ts`, cookie logic tests in
  `tests/consent.test.ts`, and measured colour contrast for the marketing
  palette. This was not an independent audit.

This record replaces the old assumption that the release checklist was an
audit. The checklist remains the release gate; this document records the
criterion-by-criterion review, the defects found and their fixes, and the
checks that still need a human or a real browser.

## Defects found and fixed

### 1.4.3 Contrast (Minimum)

Measured with the WCAG relative-luminance formula:

| Foreground | Background | Before | After | Result |
| --- | --- | --- | --- | --- |
| `#8c887f` | `#f4f3ee` cream | 3.18:1 | — | Failed normal text |
| `#8c887f` | `#ffffff` white | 3.32:1 | — | Failed normal text |
| `#6b6862` | `#f4f3ee` cream | — | 5.00:1 | Pass |
| `#6b6862` | `#ffffff` white | — | 5.55:1 | Pass |
| `#8c887f` | `#1c1b19` dark footer | 4.87:1 | 4.87:1 | Pass, retained |

Every small muted label on a cream or white marketing surface now uses
`#6b6862`: the landing steps, card labels, pricing notes, comparison table
headers and footnotes, pricing cards, lifetime offer, demo note and comparison
pages. The dark landing footer keeps `#8c887f`, where it passes. The public
theme tokens were checked separately and already pass: `#6b6862` on `#f4f3ee`
is 5.00:1 and `#a8a39a` on `#161513` is 7.27:1.

### 2.4.1 Bypass Blocks

`MarketingPage` (pricing, comparison, demo and open-source routes using it) and
`LegalShell` had repeated navigation but no skip link. Both now start with a
skip link and a focusable `main` (`#main` / `#legal-main`, `tabIndex={-1}`).
The landing page already had a skip link; its `main` is now focusable too so
keyboard focus, not just scroll position, moves with it.

### 1.3.5 Identify Input Purpose / 3.3.2 Labels or Instructions

The public search page used a placeholder as its only label and moved focus into
the field on load. It now has a visible-to-assistive-technology `<label>`, a
stable `id`, a 44 px field and button, and no autofocus. The header search input
already had a matching label.

### 2.5.8 Target Size (Minimum)

New interactive controls meet the 24×24 CSS px minimum and the project's 44 px
preference for primary actions: consent choices (`min-h-11`), the embed load
button (`min-h-11`), search field/button (`h-11`), and the settings control
(`min-h-6`). The existing language switch keeps its tested 24 px target.

### 2.1.1 Keyboard / 2.1.2 No Keyboard Trap

The consent banner is a non-modal region, not a focus trap. Every action is a
native button, “Essential only” is available as the dismiss action, and the page
behind it remains operable. The search ranking explanation is a native
`<details>/<summary>`, so it opens from the keyboard. The YouTube placeholder is
a native button; the iframe is not rendered until it is activated or all
optional storage is accepted.

### 4.1.2 Name, Role, Value / 4.1.3 Status Messages

The consent banner is labelled by its heading and described by its body, with a
clear button group. The embed placeholder names the action (“Load video”) and
explains the consequence. Result cards are links with text content; the result
count is rendered as text, not colour or an icon alone. Query metadata is
`noindex, follow` and does not alter the accessible page.

## Criterion review

The table records the criteria that needed a source change or a note. Criteria
not listed were reviewed and found satisfied in source: language, page titles,
headings, link purpose, consistent navigation/identification, no keyboard
shortcut conflicts, no flashing content, native pointer cancellation, and
text-based status visuals.

| Criterion | Status | Evidence / residual check |
| --- | --- | --- |
| 1.1.1 Non-text Content | Pass in source | Decorative icons are `aria-hidden`; screenshots and logos have alt text or empty alt when the adjacent text names them. |
| 1.2.x Prerecorded media | Author-dependent | YouTube is third-party content. Captions/transcripts depend on the video owner; the player is not loaded before consent. |
| 1.3.1 Info and Relationships | Pass in source | One `h1`, ordered headings, landmarks, table headers and captions on trust/subprocessor pages. |
| 1.3.2 Meaningful Sequence | Pass in source | DOM order matches the visual order; fixed banners are supplementary. |
| 1.3.4 Orientation / 1.3.5 Identify Input Purpose | Pass in source | No orientation lock; search and public forms have programmatic labels and `type`/`name`. |
| 1.4.1 Use of Color | Partial | Status and category badges include text; link styling is not colour-only. Focus/selection states still need a visual check. |
| 1.4.3 Contrast (Minimum) | Fixed | See the measured table above. |
| 1.4.4 Resize Text (200%) | Not verified | Requires a browser pass; layout uses rem/relative sizes and wrapping. |
| 1.4.10 Reflow (320 px) | Not verified | Existing 360 px checklist pass; 320 px and 400% zoom need a browser pass. |
| 1.4.11 Non-text Contrast | Not verified | Borders, focus rings against brand accents and chart marks need measured runtime checks. |
| 1.4.12 Text Spacing | Not verified | Needs a browser pass with increased line/letter/word spacing. |
| 1.4.13 Content on Hover or Focus | Not verified | Menus and profile popovers need dismiss/hoverable/persistent checks in a browser. |
| 2.2.1 Timing Adjustable | Pass in source | No timed public content; magic-link expiry is a security control, not a page time limit. |
| 2.2.2 Pause, Stop, Hide | Not verified | No essential auto-playing motion; any animation must be confirmed in the browser. |
| 2.4.3 Focus Order | Not verified | DOM order is sensible; sticky headers and the consent banner need a keyboard walk. |
| 2.4.4 Link Purpose | Pass in source | Links use visible text or accessible names; icon-only links have labels. |
| 2.4.5 Multiple Ways | Pass | Header/footer navigation, sitemap and public search. |
| 2.4.6 Headings and Labels | Pass in source | Page `h1`, section `h2`, labelled form controls; search fixed. |
| 2.4.7 Focus Visible | Pass in source | Global `:focus-visible` outline; new controls are native. Confirm against brand accents in a browser. |
| 2.4.11 Focus Not Obscured (Minimum) | Not verified | Sticky marketing header and fixed consent banner must be checked while tabbing to the footer. |
| 2.5.3 Label in Name | Pass in source | Visible labels match accessible names; language links use the language name as both label and title. |
| 2.5.7 Dragging Movements | Not applicable / review | Screenshot annotation is an optional enhancement with upload/paste alternatives; no required drag interaction was found on public pages. |
| 3.1.1 Language of Page | Pass | Root document/marketing pages declare English; the public workspace wrapper declares the resolved `en`/`es` locale. |
| 3.1.2 Language of Parts | Author-dependent | Customer-written titles/bodies are not language-tagged; a workspace mixing languages needs content-level review. |
| 3.2.1 On Focus / 3.2.2 On Input | Pass in source | No focus-triggered navigation; search and filters submit through explicit controls. |
| 3.2.6 Consistent Help | Pass in source | Public help/support links occupy the same header/footer positions. |
| 3.3.1 Error Identification | Partial | Forms render server/client errors as text; every public form flow still needs an error-state keyboard check. |
| 3.3.2 Labels or Instructions | Fixed | Search label fixed; required/optional fields and attachment limits have visible text. |
| 3.3.3 Error Suggestion | Not verified | Validation messages exist, but correction guidance needs a browser walk through submit, login and preferences. |
| 3.3.4 Error Prevention (Legal, Financial, Data) | Not verified | Billing and destructive workspace actions are outside the public surface; public submit has a receipt and preview. |
| 3.3.7 Redundant Entry | Not verified | Multi-step public submit/preferences need a browser pass. |
| 3.3.8 Accessible Authentication | Pass in source | Email magic link, no cognitive puzzle, paste allowed; SSO is an alternative. |
| 4.1.3 Status Messages | Partial | Receipts and errors use `role="status"`/visible text; a live-region audit across every async action is still needed. |

## Verification run

- `bunx tsc --noEmit --incremental false`
- `bunx eslint` on every touched file
- `bun --conditions=react-server test tests/public-accessibility.test.ts tests/consent.test.ts tests/public-similarity.test.ts`
- `bun run build`

The unit/structural checks cover markup contracts and cookie parsing. They do
not simulate a screen reader, zoom, high-contrast mode or a touch target in a
real browser.

## Residual work before claiming conformance

A human reviewer still needs to run:

1. NVDA on Windows and VoiceOver on macOS through board, request, submit, search,
   consent and legal pages.
2. Browser zoom at 200% and 400%, plus 320 px reflow, with the sticky header and
   consent banner open.
3. Keyboard-only tab order, focus visibility and focus-not-obscured checks on
   every public route.
4. Text-spacing overrides and non-text contrast for borders, charts and brand
   accents.
5. Error, empty and loading states in submit, login, preferences and search.
6. A sample of customer content in a second language to decide whether
   language-of-parts markup is needed.

Until those are recorded, this is a completed source audit and a list of known
residual checks, not a claim of independent WCAG 2.2 AA certification.
