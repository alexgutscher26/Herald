# Accessibility and responsive checklist

Scope: every public surface (board, request, submit, roadmap, changelog,
sign-in, preferences, public 404 and widget embed) and the dashboard primary
flows (overview, releases, feedback, conversations, moderation, boards,
roadmap, analytics, operations, import/export, subscribers and settings).

This is the release gate checklist, not a claim that an independent WCAG 2.2 AA
audit has been completed. The structural checks run in CI; the behavioural
checks are recorded with the evidence that produced them. The
[criterion-by-criterion public audit](accessibility-audit.md) and the
[dashboard, portal-form and widget audit](accessibility-audit-dashboard.md) record
the 2026-11-21 source audits, their fixes and the remaining manual checks.

| Check | Result | Evidence |
| --- | --- | --- |
| One `main` landmark per page, reachable by a skip link | Pass | `tests/public-accessibility.test.ts` and `tests/dashboard-accessibility.test.ts`; `Tab` focuses “Skip to content” and `Enter` moves focus to `main#public-main` / `main#dashboard-content`. |
| Keyboard-only path for submit, vote, comment, follow, filters and primary dashboard actions | Pass | Public controls are native links, buttons and form fields. Feedback `j`/`k`/`x`/`/`/`?` shortcuts are additive; every action also has a focusable button. |
| Visible focus | Pass | Global `:focus-visible` outline (2 px, 2 px offset); the skip link expands from visually hidden to a 122×37 target on focus. |
| Labelled controls | Pass | Public form controls have matching labels; analytics, operations and settings tables use header cells; icon links have text or `aria-label`. |
| Sensible heading order | Pass | One `h1` per page; section cards use `h2`; dashboard page headers render the page title once. |
| 360 px layout, no horizontal scroll | Pass | Grids collapse to one column; wide settings/operations tables use an overflow-x container with a minimum width rather than forcing the page wider. Long words use `break-words`/`break-all`. |
| Target size | Pass | Interactive controls are at least 24×24 CSS px at 360 px, except the intentionally off-screen skip link, which expands on focus. The dashboard adds a tested 24 px minimum for buttons, role-buttons, summaries, selects and native choice controls at widths up to 767 px. |
| Charts and status visuals have a text equivalent | Pass | Analytics bars expose an accessible label plus a title/table value; funnel and job counts are rendered as text and are not colour-only. |
| Reduced motion | Pass | No essential transition depends on animation; the global `prefers-reduced-motion` override and the widget stylesheet's own override are both present and structurally tested. |

## Manual dashboard pass

At a 360 px viewport and with keyboard only:

1. Open overview → analytics → operations. The skip link focuses the main
   landmark; every chart/table is reachable and no page scrolls horizontally.
2. Open settings → Privacy. Review the export link, owner-only transfer/customer
   erasure controls and the deletion request/cancel flow. The destructive
   actions are buttons with visible labels and confirmations, not icon-only
   controls.
3. Open feedback and conversations. Run the shortcut help, move focus through
   filters and invoke one row action without a pointer.
4. Re-run `bun test tests/public-accessibility.test.ts tests/dashboard-accessibility.test.ts`.

Known limitation: a screen-reader pass with VoiceOver/NVDA, 320 px/200%/400%
visual checks and measured non-text contrast on the final brand palette still
need a human reviewer. The dashboard and widget source audit is recorded in
`docs/accessibility-audit-dashboard.md`. Do not mark a release as WCAG AA solely
from this checklist.
