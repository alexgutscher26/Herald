# ADR 0002: Feedback status is the roadmap source of truth

- **Status:** Accepted
- **Date:** 2026-10-25
- **Applies to:** `src/db/schema/feedback.ts`, `src/db/schema/roadmap.ts`,
  `src/features/releases/publish-effects.ts`, the internal and public roadmaps,
  public projections, overview counts

## Context

Herald had two status vocabularies:

- `feedback_status`: `open`, `under_review`, `planned`, `in_progress`,
  `shipped`, `closed` — editable from the feedback inbox and rendered on public
  boards.
- `roadmap_status`: `under_review`, `planned`, `in_progress`, `shipped`,
  `declined` on `roadmap_items`, which could be linked to feedback through
  `roadmap_feedback_links`.

Roadmap editing had no UI, while feedback status was the value users changed
and the dashboard counted. A roadmap item could set its own status
independently, so the same request had two answers to "are we building this?"
and publishing a release would only update one of them. Migration `0012` drops
both roadmap tables; a linked feedback post remains and is itself the roadmap
card.

Moderation is a separate concern: `moderation_reviews` decides whether content
is visible, never what stage of delivery it is in.

## Decision

Feedback status is the canonical answer to "what are we building, and how far
along is it?" There is no second roadmap model.

1. The six feedback states are the only product vocabulary. The former
   `declined` value was folded into `closed`; it must not be reintroduced.
2. Publishing a release marks linked feedback `shipped` in the same
   transaction. That propagation lives in `applyPublishedFeedbackEffects` and is
   shared by manual and scheduled publishing.
3. Merged requests are hidden; their votes and comments belong to the target
   request, whose status is the one that counts and appears on the roadmap.
4. Public and dashboard counts and the public roadmap derive from
   `feedback_posts.status`.
5. The internal roadmap is a kanban over those statuses. Its drag/drop and the
   feedback detail's status menu call the same update path; no roadmap row is
   written. The public roadmap publishes only `planned`, `in_progress` and
   `shipped` cards that pass the board visibility and moderation predicates.

## Consequences

- "Planned" means the same thing in the inbox, on a public board and on the
  roadmap. There is one place to change it.
- There is one place to change status: the feedback request. Editing the
  roadmap edits that request.
- Status history is not recorded yet. Add an audit trail when notifications or
  reporting need to explain a transition, not just the current value.

## Alternatives considered

- **Roadmap as the source of truth.** Rejected: feedback status is already
  customer-visible and editable, and two writable statuses drift immediately.
- **Free-form tags or a kanban column only.** Rejected: tags are not
  enforceable, not countable and not public-safe.
- **Keep separate statuses and sync periodically.** Rejected: eventual
  consistency is indistinguishable from a bug for a customer checking a request.

## Open work

- Add a status-history table when roadmap editing or notifications need to
  explain a transition, not just the current value.
