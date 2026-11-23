# Installing the Herald widget

The dashboard Widget page prints the exact snippet for the product, with the
public key and the saved launcher defaults already filled in. The examples below
use the same values; replace `https://herald.example.com`, `workspace/product`
and `hpk_…` with the ones from that page.

Before you start:

- At least one public surface (feedback, roadmap or changelog) must be enabled
  for the product.
- Copy `data-key` from the Widget page. Once a workspace has widget settings the
  key is mandatory, and both a missing/stale key and an origin outside the saved
  allowlist render the 404 page instead of a panel.
- Add every origin you embed from under **Allowed origins** (for example
  `https://app.example.com`). An empty list keeps the widget open to any origin;
  entries are exact scheme/host/port values with no wildcards or paths.

There is no build step and no inline bootstrap: every framework below ends up
rendering the same single `async` script tag, and the loader queues API calls
made before it finishes mounting. After installing, run the installation check
on the Widget page; the manual browser matrix is
[docs/widget-browser-smoke.md](widget-browser-smoke.md).

The customer-facing article
[docs/help/install-the-widget.md](help/install-the-widget.md) adds Vue 3,
Svelte/SvelteKit and Astro recipes, the signed-identity handoff and the
404/offline/blocked-cookie failure states. This page remains the technical
reference for the snippet and the policy.

## Plain HTML

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Acme</title>
  </head>
  <body>
    <main>
      <h1>Acme</h1>
      <p>Your product, with feedback one click away.</p>
    </main>

    <script
      async
      id="herald-widget"
      src="https://herald.example.com/widget/v1.js"
      data-project="workspace/product"
      data-key="hpk_…"
      data-position="bottom-right"
      data-theme="auto"
    ></script>
  </body>
</html>
```

The custom-trigger and inline `embed()` recipes on the Widget page add a host
element and container when you want them; the floating launcher needs nothing
else.

## React

If you control `index.html`, put the same tag there and skip this component. For
single-page apps that mount everything from JavaScript, create the tag once:

```tsx
// src/components/HeraldWidget.tsx
import { useEffect } from "react";

declare global {
  interface Window {
    HeraldWidget?: {
      open(panel?: string): void;
      navigate(panel: string): void;
      identify(token: string): Promise<void>;
      logout(): Promise<void>;
    };
  }
}

export function HeraldWidget() {
  useEffect(() => {
    if (document.getElementById("herald-widget")) return;

    const script = document.createElement("script");
    script.id = "herald-widget";
    script.async = true;
    script.src = "https://herald.example.com/widget/v1.js";
    script.dataset.project = "workspace/product";
    script.dataset.key = "hpk_…";
    script.dataset.position = "bottom-right";
    script.dataset.theme = "auto";
    document.body.appendChild(script);
  }, []);

  return null;
}
```

Render `<HeraldWidget />` once next to your app root. The dataset properties are
just the `data-*` attributes: `HeraldWidget.open("feedback")`,
`navigate("roadmap")` and the rest of the API work even before the loader
mounts, because calls are queued.

When your own sign-in completes, carry the identity over:

```tsx
useEffect(() => {
  if (!signedToken) return;
  void window.HeraldWidget?.identify(signedToken).catch(() => {
    // Invalid or expired; the loader logs and emits an "error" event.
  });
}, [signedToken]);
```

Only a backend-signed HS256 JWT is accepted (`sub`/`iss`/`aud`/`iat`/`exp`, at
most one hour, minted with the workspace signing secret); `logout()` clears the
shared customer session. Invalid or expired tokens fail closed.

## Next.js (App Router)

React 19 hoists an `async` script into the document head and de-duplicates it,
so a plain element in the root layout is the whole installation:

```tsx
// app/layout.tsx
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
        <script
          async
          id="herald-widget"
          src="https://herald.example.com/widget/v1.js"
          data-project="workspace/product"
          data-key="hpk_…"
          data-position="bottom-right"
          data-theme="auto"
        />
      </body>
    </html>
  );
}
```

Identity is the same call as in React: `HeraldWidget.identify(signedToken)`
inside a client component once your session is ready.

## Content-Security-Policy

The loader touches the host page in exactly three ways, so the policy needs
three directives for the Herald origin:

| Directive | Needed for |
| --- | --- |
| `script-src` | `/widget/v1.js` |
| `style-src` | `/widget/v1.css`, loaded into the launcher's shadow root |
| `frame-src` | the embed iframe (`/p/{workspace}/{product}/embed`) |

```http
Content-Security-Policy:
  script-src 'self' https://herald.example.com;
  style-src 'self' https://herald.example.com;
  frame-src https://herald.example.com;
```

- **No `unsafe-inline`:** the loader is an external file and its stylesheet is a
  separate file; no inline `<script>` or `<style>` element is created. A host
  page with a strict script
  policy therefore only needs the Herald origin added to the directives it
  already has — including any `default-src` fallback it relies on.
- **Nonce-based style policies:** add `data-nonce="<nonce>"` to the script tag
  and the loader copies it to the `<link rel="stylesheet">` it creates inside
  the shadow root. The script tag itself still needs the host's own nonce when
  `script-src` uses nonces, as with any external script. The nonce must be
  generated per response; never ship a fixed value. There is no inline
  `<style>` or `style` attribute that would need `'unsafe-inline'`.

### Launcher position and theme per origin

**Widget → Allowed origins → Per-origin overrides** can set a launcher position,
a theme, or both for one exact origin. The embed resolves the override from the
`host` it was loaded with and reports it to the loader, so the snippet stays a
single tag and no extra request is made. An explicit `data-position` or
`data-theme` in that installation's snippet still wins. Overrides are only
accepted for origins already in the allowlist.

### Offline, unreachable and blocked cookies

The loader never leaves an empty frame. If the host goes offline, the embed does
not answer the state handshake within 12 seconds, or the iframe cannot write a
session cookie (third-party cookie blocking), the panel shows a short explanation
with **Try again** and **Open in a new tab**. The iframe's own document may still
load when cookies are blocked; the message is what distinguishes that from an
empty inbox.

### Triggering a survey or banner from an event

Surveys, banners and tours share one targeting model. A rule of type `page_url`
matches the host URL, `time_on_page`, `selector` and `event` are evaluated by
the loader, and `attribute` rules are evaluated on the server from the
identified customer's traits. Rules are ANDed and deny by default.

An `event` rule waits for a product event. Fire it from JavaScript once the
thing happened:

```js
HeraldWidget.track("checkout_completed");
```

On a button or link, the same event can be declared in markup with no extra
script — the loader delegates the click:

```html
<button data-herald-event="checkout_completed">Finish checkout</button>
```

A survey with the audience `[{"type":"event","value":"checkout_completed"}]`
is then eligible on that page load. Attribute rules are the only ones enforced on
the server: they gate a direct survey link and the portal listing, while page,
time, selector and event rules only decide when the widget prompts. Page, time, selector and event targeting are
local to the browser; the widget fetches eligible surveys from
`/api/public/widget/experiences` and records an impression only when the prompt
is actually rendered, at most once per visitor per survey per UTC day. The Free plan allows 500 proactive impressions a month;
paid plans are unlimited. A survey's own suppression window still applies after
a response.

### Versions

`HeraldWidget.version` is the loader URL (`v1`) and `HeraldWidget.protocol` the
frame handshake. Upgrading to a future `v2.js`, the cache-key rule and the
warning surfaces are in [widget-versioning.md](widget-versioning.md).
- **`connect-src` is not required by the launcher.** Its network calls run
  inside the iframe, under Herald's own origin; the host page only adds a
  script, a stylesheet and a frame. Add the Herald origin to `connect-src`
  anyway if your own page code also calls Herald directly.
- **`frame-ancestors` is Herald's to manage**, not yours; your policy only
  decides which frames your page may embed. Herald answers the embed path with
  `frame-ancestors 'self'` plus every origin from **Allowed origins**, and sends
  no `X-Frame-Options` there because an origin allowlist cannot be expressed in
  that header. Every other Herald route answers `frame-ancestors 'none'` with
  `X-Frame-Options: SAMEORIGIN`, so a page outside the allowlist cannot frame
  the widget at all — the browser refuses the frame before the panel renders.
- **`display-capture`:** the submission form's screenshot button calls
  `getDisplayMedia`. The loader already sets `allow="display-capture"` on the
  iframe; if your page sends its own `Permissions-Policy`, include
  `display-capture=(self "https://herald.example.com")` or the capture button
  reports that it is unavailable (paste and file upload still work). Herald
  denies `camera`, `microphone` and `geolocation` on every response and allows
  `display-capture` only on the submission and embed routes.

Herald's own served policy — the enforced directives, the report-only fetch
policy and the per-route `frame-ancestors` and `Permissions-Policy` decisions —
is built in [src/features/security/policy.ts](../src/features/security/policy.ts).
Keep this section and that file in step when a new external host is added; the
integration test in
[tests/integration/csp-surfaces.test.ts](../tests/integration/csp-surfaces.test.ts)
fails when a page references an origin the policy does not allow.
