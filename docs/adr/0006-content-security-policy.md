# ADR 0006: Enforce a narrow CSP, observe the full one

- **Status:** Accepted
- **Date:** 2026-11-22
- **Applies to:** `src/features/security/policy.ts`, `src/proxy.ts`,
  `src/features/widget/frame-bridge.tsx`, `public/widget/v1.js`,
  `tests/integration/csp-surfaces.test.ts`

## Context

Herald serves four kinds of surface from one origin:

- the dashboard, a Next.js app with framework scripts and styles;
- public portals with workspace theming and customer content;
- API and auth routes that return JSON or redirects;
- the widget embed, which a customer's site frames and whose loader runs on
  that site's page.

A single strict `script-src 'self'` policy would break the framework's inline
bootstrap. A permissive `unsafe-inline` policy would make the policy
decorative. Framing is the other half: the embed must be frameable by the
workspace's allowed origins, while every other route must refuse framing
outright. The widget's screenshot annotator also needs `display-capture` on
exactly two routes, and no page needs camera, microphone or geolocation.

## Decision

Send two policies on every response:

1. **Enforcing:** `base-uri 'self'`, `object-src 'none'` and a per-route
   `frame-ancestors`. These directives cannot break a legitimate render and
   close the highest-value injection surfaces.
2. **Report-only:** the full fetch policy, including the `script-src` and
   `style-src` allowances the app still needs. It reports violations instead of
   blocking, so the policy can be tightened against real console reports before
   it is promoted.

Framing is decided per route, not globally:

- `/p/{workspace}/{product}/embed[/...]` is the only frameable surface.
- Its `frame-ancestors` is `'self'` plus the workspace's exact allowed origins.
  An unconfigured workspace or an empty allowlist means `*`, matching the
  embed gate so the header never disagrees with the page it protects.
- Every other route answers `frame-ancestors 'none'` and
  `X-Frame-Options: SAMEORIGIN`.
- `Permissions-Policy` denies camera, microphone and geolocation everywhere.
  `display-capture` is allowed on the embed and submission routes only; the
  loader sets `allow="display-capture"` on the iframe.

The widget is designed to need no `unsafe-inline`: the loader is an external
file, its stylesheet is a separate file loaded into the shadow root, and no
inline `<script>`, `<style>` or `style` attribute is created. A host with a
nonce-based policy can pass `data-nonce` and the loader copies it to the
stylesheet link; the script tag still needs the host's own nonce.

## Consequences

- The enforcing policy blocks `object`/`base` injection and framing now. It
  does not yet block an injected inline script; that is the report-only
  policy's job until it is promoted.
- Adding an external host requires a code change in `policy.ts` and a test
  update. The integration test fails when a built page references an origin
  the policy does not allow, so this is a build-time failure rather than a
  production console error.
- The widget's CSP instructions are part of the installation contract:
  `script-src`, `style-src` and `frame-src` need the Herald origin. A host
  that omits one sees an empty frame or no launcher.
- A workspace origin is part of an HTTP header, so the allowlist is
  authoritative per request. The allowlist accepts exact origins only; a
  wildcard or path is refused at save time.
- Promoting the report-only policy is a separate change. It needs a clean
  report window on the public board, the dashboard, the embed and the API
  docs, and it must keep the widget's nonce path working.

## Verification

- `tests/integration/csp-surfaces.test.ts` walks six surfaces and asserts the
  framing and `Permissions-Policy` headers, and fails when a build references a
  host the policy does not allow.
- `src/features/security/policy.ts` is framework-free so the proxy, the embed
  lookup and the tests share one interpretation.
- The widget's no-inline claim is checked by the browser matrix, which loads
  the real loader and stylesheet from a fixture origin.

Limit: a report-only policy does not block. Do not describe the deployment as
having a fully enforcing CSP until the report-only policy is promoted and the
test is updated to match.
