# ADR 0003: Roles are workspace-wide, not per product

- **Status:** Accepted
- **Date:** 2026-11-20
- **Applies to:** `src/lib/permissions.ts`, `workspace_members`,
  `workspace_member_custom_roles`, `src/lib/authz.ts`, every server action and
  route handler

## Context

A workspace can contain several products, and the feedback backlog asked
whether a person could be an editor on one product and a viewer on another
("per-product role overrides"). Today a member has one role for the whole
workspace, optionally widened by a custom role, and every authorization check
resolves that membership once.

That model has consequences worth naming:

- `workspaceMembers.role` is the single row the session resolves. A per-product
  role would add a second lookup to every action and page.
- Products are not tenants. Boards, feedback and conversations are scoped to a
  product, but billing, membership, audit and API tokens are scoped to the
  workspace. A person with two roles on two products would still have one seat,
  one billing relationship and one audit identity.
- Several surfaces are deliberately workspace-level: the API token list, the
  audit log, SCIM provisioning, seat counting and domain capture. A per-product
  role has no meaning on any of them, so the model would need a rule for "which
  product governs this token?".
- Support conversations are staffed centrally; an operator who can read the
  inbox for one product but not another is an assignment question, not a
  permission question.

## Decision

Roles stay workspace-wide. There are no per-product role overrides.

1. One `workspace_members.role` per person per workspace; `permissions.ts` is
   the only source of the role → permission mapping.
2. A custom role is additive to that base role and applies to the whole
   workspace. It cannot remove a base permission and cannot grant owner-only
   controls.
3. Product-scoped work is expressed through assignment (conversation assignee,
   board membership is not a permission) and through the product picker, not
   through a second role.
4. The access page at `/app/{workspaceSlug}/settings/access` renders the matrix
   for the current workspace from the same module the server enforces, so the
   answer to "who can do what" cannot drift from behaviour.

## Consequences

- Authorization stays a single membership read; no query or page needs a
  product-specific role.
- Adding a product never changes who can do what, which keeps onboarding and
  SCIM provisioning predictable.
- A customer who genuinely needs different access per product gets a second
  workspace instead. That is a real cost, accepted because products in one
  workspace share billing, audit and API credentials.
- If per-product roles are ever added, the change is a new table plus a
  resolution rule in `requireProductContext`; the audit log, tokens and seat
  count would need an explicit "workspace role wins" rule.

## Alternatives considered

- **A `workspace_member_product_roles` table resolved inside
  `requireProductContext`.** Rejected for now: it doubles the authorization
  surface, and workspace-level surfaces (tokens, audit, SCIM, seats) have no
  product to resolve against.
- **Per-product custom roles.** Rejected: custom roles already widen a person;
  making them product-scoped multiplies the matrix without a demonstrated need.
- **Board-level permissions.** Rejected: boards are visibility containers, not
  authorization boundaries. Private boards are already gated by plan and
  visibility, not by membership.
