# ADR 0004: Permanently removed public content returns 404, not 410

- **Status:** Accepted
- **Date:** 2026-11-21
- **Applies to:** `src/app/p/**` public pages, `src/app/p/[workspaceSlug]/not-found.tsx`,
  `src/features/public/queries.ts`, `src/features/public/redirects.ts`

## Context

Search engines treat a `410 Gone` as a stronger signal than `404 Not Found` that
a URL is permanently absent, so a crawler may drop it sooner. The public surface
has several ways a URL can stop resolving:

- a board is archived, made private or its workspace loses the public surface;
- a request is hidden, archived, rejected by moderation, merged into another
  request, or its author is banned;
- a workspace, product or board is renamed or deleted;
- a request is genuinely deleted by its owner.

The App Router's page-level `notFound()` always renders the not-found boundary
with a `404` status. A page cannot return `410` without replacing the route with
a route handler that builds the whole response itself. A middleware rewrite can
change the status but cannot know which records are removed without duplicating
the public visibility projections in middleware, where database access and the
tenant resolver are not available.

The anti-enumeration rule is the deciding constraint. Removed, private, hidden,
banned and never-existing requests must be indistinguishable. If a removed
request returned `410` while a private request returned `404`, anyone could
probe an id and learn that it once existed. If both returned `410`, the response
would confirm that an id belongs to the workspace even when it was never public.
Neither is acceptable for a multi-tenant feedback surface.

A merged duplicate is different: it has a public canonical target, so it already
returns a permanent `308` redirect from
`getMergedRequestCanonicalId`. That preserves link equity without disclosing a
removed record.

## Decision

1. Removed public content returns `404` permanently. This includes archived
   boards, hidden and archived requests, rejected moderation decisions, banned
   authors and deleted records.
2. We do not add a `410` path that depends on the removal reason. The public
   visibility projections already collapse those reasons into "not found", and
   they must stay indistinguishable at the HTTP layer.
3. Merged requests keep the existing permanent `308` redirect to their canonical
   request when that target is publicly readable.
4. `robots.txt` keeps the public surface crawlable and excludes token-bearing
   and signed-in routes. Removed URLs remain in the sitemap only until the next
   sitemap generation, then disappear from the projections.
5. If the App Router later exposes a page-level way to set `410` without
   bypassing the shared not-found boundary, we will revisit only for content
   whose removal is already public (for example a published changelog entry
   explicitly retracted with a public notice). It must not be driven by a
   private/removed distinction.

## Consequences

- Crawlers receive a correct permanent-removal signal for merged duplicates and
  a `404` for everything else. They may retain a removed URL slightly longer
  than with `410`; the sitemap and canonical links still converge.
- No route needs a second visibility implementation, and the anti-enumeration
  guarantee holds for every public object type.
- A future `gone()` page primitive can be adopted without changing the
  projections; the decision is recorded here so the absence of `410` is
  intentional rather than an oversight.
- Operators who need a `410` for legal or regulatory reasons should front the
  deployment with a rules layer that returns it for an explicitly published
  list, not by weakening the tenant resolver.
