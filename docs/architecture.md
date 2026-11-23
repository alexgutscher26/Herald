# Module boundaries

Herald is layered so a page cannot accidentally become a database client and a
feature cannot own its own copy of a cross-cutting rule.

```text
src/app/**                 routes, layouts, pages, route handlers, server actions
        │
        ▼
src/features/**            use cases: parse input, authorize, orchestrate
        │
        ├──────────────► src/lib/**       pure helpers and framework adapters
        │
        ▼
src/db/queries/**          typed read projections
        │
        ▼
src/db/schema/**           drizzle table definitions
src/db/index.ts            pool and `db` client
```

## Rules

1. **Routes may import features, queries and lib.** A page or route handler
   resolves the URL, calls a feature or query, and renders. It must not contain
   business rules that another caller would need to repeat.
2. **Features may import queries, schema types and lib.** A feature owns the
   transaction that makes one use case true; it never reaches into another
   feature's internals when a public function exists.
3. **Queries may import the schema and the db client.** They return typed
   projections, not raw driver rows, and never perform authorization.
4. **`src/lib/**` stays framework-light.** Pure helpers (`tenancy`, `format`,
   `dates`, `pagination`, `action-result`) must not import `next/headers`, the
   database or a feature. Server-only adapters say `import "server-only"`.
5. **A client component must never import `src/db` or `src/lib/authz` at
   runtime.** `"use client"` modules receive serializable props; queries run in
   a server component, route handler or server action. The ESLint rule
   `herald/no-db-in-client` fails the build on a runtime `@/db`/`@/db/*` or
   `@/lib/authz` import from a client module. Type-only imports are erased at
   build time and are allowed. `tests/module-boundaries.test.ts` checks the same
   boundary from the source text.
6. **Authorization happens once, in `src/lib/authz.ts`.** Pages call
   `requireProductContext` or the page helper `resolveProductPage`; actions call
   `authorizeProductAction` / `authorizeWorkspaceAction`. Those helpers
   authenticate, resolve the tenant, enforce the permission and turn an unknown
   tenant into a 404 in that order. An action authorization helper also enforces
   the explicit same-origin guard.
7. **Every server action returns `ActionResult<T>`.** Success is
   `{ ok: true, data }`; failure is `{ ok: false, error }` with an optional
   `billingUrl` or `fieldErrors`. Client callers use `toastActionFailure`
   rather than reading `.error` themselves.
8. **Every list uses the shared pagination helpers.** Page-number readers use
   `paginationMeta`/`pageOffset`; keyset readers use `encodeCursor`/
   `decodeCursor`. Neither a feature nor a route invents its own cursor format.
9. **Every date/time render uses `src/lib/dates.ts`.** Formatters pin the locale
   and take an explicit IANA timezone. Do not call `new Date()` inline in a
   render path; use `now()` or a value passed from the server so hydration sees
   the same instant.

## Import direction

The allowed direction is downward only:

```text
app → features → db/queries → db/schema
app → lib
features → lib
```

An upward import (`lib` → `features`, `db` → `app`) is a design error. A few
older schema and query modules still import shared feature types; new code
should move a shared shape to `src/lib` or keep the import type-only. The
repository uses `@/` aliases; relative imports are fine inside one feature.
