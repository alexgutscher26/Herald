# ADR 0001: Customers are not workspace users

- **Status:** Accepted
- **Date:** 2026-10-25
- **Applies to:** `src/db/schema/customers.ts`, `src/db/schema/workspaces.ts`,
  `src/features/customer-session/`, `src/features/public/`

## Context

Herald has two audiences with different trust levels:

- **Workspace members** sign in with Better Auth, belong to a workspace through
  `workspace_members`, and reach the dashboard with an `owner`, `admin` or
  `editor` role.
- **Customers** read public boards and may vote, comment or submit feedback.
  They arrive without an account, from an untrusted browser, and must never be
  able to reach the dashboard.

A public visitor also has none of the properties Better Auth assumes: no
password, no verified address, and often no address at all until they choose to
identify. Treating a visitor as a `user` row would make every future dashboard
authorization check responsible for excluding them.

## Decision

Keep the two identities separate.

1. Customers live in `customers`, scoped to one workspace. Email and external
   ids are unique **per workspace**, not globally, and both are nullable
   because a guest exists before either is known. `verified_at` and `banned_at`
   are per-workspace state.
2. Public sessions live in `customer_sessions` and are not Better Auth
   sessions. The cookie is HMAC-signed, `httpOnly`, short-lived (24 hours), and
   the database stores only a SHA-256 hash of the token.
3. `identify` attaches an email and rotates the token; a guest token must not
   survive a privilege change. An address already owned by a different customer
   is rejected as a conflict rather than merged, because no address is verified.
4. Feedback attribution keeps the two principals in separate columns:
   `feedback_posts.author_id` references a Better Auth `user` (team), while
   `feedback_posts.author_customer_id` references a customer. Neither column
   grants the other's access.
5. A customer row never authorizes a dashboard route, server action or team
   query. Dashboard authorization continues to start from `requireUser()` and
   `workspace_members`.

## Consequences

- Public code cannot reuse the dashboard session, and dashboard code cannot
  accidentally accept a customer cookie. The boundary is a type and table
  boundary, not a runtime role check.
- The same person visiting two workspaces is two customer rows. Per-workspace
  bans, traits and email uniqueness stay coherent; cross-workspace customer
  analytics require the email to be treated as a hint, not a key.
- Verified identity and account merging need a future magic-link or
  verification flow. Until then, "identify" is self-asserted and must not be
  used to hand over existing data.
- Any new public feature must scope its query by `workspace_id` explicitly.
  There is no tenant middleware to fall back on.

## Alternatives considered

- **Create a `user` row per visitor.** Rejected: it hands visitors Better Auth's
  entire surface, makes global email uniqueness wrong, and puts guest accounts
  in the dashboard's user table.
- **One global customer table.** Rejected: bans, email uniqueness and traits are
  tenant decisions. A single row would leak state between workspaces.
- **A second auth provider per tenant.** Deferred: more operational surface than
  the current signed cookie, with no feature that needs it yet.

## Revisit when

Email verification or magic-link sign-in lands, or when customers ask for one
identity across multiple Herald workspaces. Either change needs an explicit
merge policy, not a relaxation of the current conflict rule.
