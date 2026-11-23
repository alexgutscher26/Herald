# ADR 0008: Release covers are storage objects, not base64 rows

- **Status:** Accepted
- **Date:** 2026-11-22
- **Applies to:** `src/features/releases/cover.ts`,
  `src/app/api/app/[workspaceSlug]/[productSlug]/releases/cover/route.ts`,
  `src/features/storage/`, `scripts/migrate-release-covers.ts`,
  `drizzle/` cover check constraints

## Context

A release cover started as a base64 `data:` URL in `releases.cover`. That
looked simple, but it had four costs:

- every list query and every backup carried the image bytes;
- a large cover inflated the row, the RSC payload and the public HTML;
- the cover could not be cached or served with its own content type;
- a check constraint could not distinguish an uploaded image from an
  arbitrary inline payload.

The storage module already existed for attachments, with magic-byte
validation, per-kind size limits, generated keys that cannot escape the root,
checksums and signed downloads.

## Decision

Store the bytes in the storage module and keep only a key in the release row
and its revisions.

- A cover is a discriminated union: `{ kind: "none" }`,
  `{ kind: "preset", preset }`, or `{ kind: "custom", key }`.
- A custom key must match
  `workspaces/{workspaceId}/products/{productId}/cover/{id}.{ext}`. A client
  cannot point a cover at another product's object, at an arbitrary path or at
  a `data:` URL.
- `POST /api/app/{workspace}/{product}/releases/cover` authorizes
  `release:write`, enforces a same-origin request, validates the uploaded
  bytes and returns `{ key, url }`. The editor keeps the key in the form.
- Reads resolve a short-lived signed URL. A legacy `dataUrl` still renders
  read-only during rollout, so no published release disappears mid-migration.
- `bun run db:migrate-release-covers` decodes legacy payloads, re-validates
  them with the upload rules, stores the object and rewrites the row. It is
  idempotent, never touches a row without a data URL, and exits non-zero
  listing every row it could not convert.
- Only after the conversion do the check constraints reject `data:`/`blob:` in
  `releases.cover`, `release_revisions.cover`, `user.image`,
  `workspace_branding.logo_key` and both attachment `storage_key` columns.

## Consequences

- Database rows and backups shrink; list queries no longer select image bytes.
- A cover can be served with the right content type, cached separately and
  replaced without rewriting a row's body.
- The database and storage must be restored together. A database-only restore
  leaves `{ kind: "custom", key }` rows pointing at missing objects. This is
  the same rule as attachments, now documented in the operations runbook.
- Signed URLs expire. A cached HTML page or an email that embeds one can show
  a broken image later; the public page re-signs on render, but an external
  copy cannot.
- Rotating `BETTER_AUTH_SECRET` invalidates outstanding signed URLs. New reads
  work; in-flight downloads must be retried.
- A workspace deletion must remove storage objects as well as rows. The local
  driver has no lifecycle rule, so the operator owns orphan cleanup.

## Verification

- `tests/release-cover.test.ts` covers the schema, the key shape and a key
  from another product's scope.
- The upload route's same-origin and permission checks are covered by the
  route tests; the migration script's refusal path is idempotent and lists
  failures.
- The dev database held 0 legacy covers when the constraint was applied, so
  the conversion path was exercised by tests, not by a large real dataset.

Limit: the storage driver is local. A cloud driver must preserve the same key
layout and checksum behaviour, and its own lifecycle rule must handle orphaned
objects.
