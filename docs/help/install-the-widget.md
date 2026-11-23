---
title: Install the widget
slug: install-the-widget
collection: Getting started
---

The widget is one versioned script. It draws a launcher in a shadow root and
opens a Herald-hosted iframe, so installing it does not add a build step, a
framework dependency or an inline stylesheet.

The Widget page prints the exact tag for your product, with the public key and
the saved defaults already filled in. The examples below use
`https://herald.example.com`, `workspace/product` and `hpk_…`; replace them
with the values on that page.

## Before you copy the snippet

- Enable at least one public surface: feedback, roadmap or changelog.
- Add every origin you embed from under **Allowed origins**. Entries are exact
  origins such as `https://app.example.com`; wildcards and paths are refused.
  An empty list keeps the widget open to any origin.
- Use the key from the Widget page. Once widget settings exist, a missing or
  stale key and an origin outside the allowlist both render the 404 page
  instead of a panel.

## Plain HTML

```html
<script
  async
  id="herald-widget"
  src="https://herald.example.com/widget/v1.js"
  data-project="workspace/product"
  data-key="hpk_…"
  data-position="bottom-right"
  data-theme="auto"
></script>
```

Put it before `</body>`. The loader queues API calls made before it finishes
mounting, so `HeraldWidget.open("feedback")` is safe from your own script even
if it runs first.

## React and Next.js

If you control `index.html`, use the plain tag. If everything mounts from
JavaScript, create the tag once:

```tsx
// src/components/HeraldWidget.tsx
import { useEffect } from "react";

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

In the Next.js App Router, a plain `<script async id="herald-widget" … />` in
the root layout is enough; React 19 hoists and de-duplicates it.

## Vue 3

```vue
<!-- src/components/HeraldWidget.vue -->
<script setup lang="ts">
import { onMounted } from "vue";

onMounted(() => {
  if (document.getElementById("herald-widget")) return;

  const script = document.createElement("script");
  script.id = "herald-widget";
  script.async = true;
  script.src = "https://herald.example.com/widget/v1.js";
  Object.assign(script.dataset, {
    project: "workspace/product",
    key: "hpk_…",
    position: "bottom-right",
    theme: "auto",
  });
  document.body.appendChild(script);
});
</script>

<template></template>
```

Mount it once in `App.vue`, outside the router view, so navigation does not
reload the launcher.

## Svelte and SvelteKit

```svelte
<!-- src/lib/HeraldWidget.svelte -->
<script lang="ts">
  import { onMount } from "svelte";

  onMount(() => {
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
  });
</script>
```

Put `<HeraldWidget />` in the root layout. `onMount` does not run during
server-side rendering, which is exactly what you want.

## Astro

Astro bundles `<script>` by default. Keep this one verbatim in the document:

```astro
---
// src/layouts/Base.astro
---
<html lang="en">
  <body>
    <slot />

    <script
      is:inline
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

`is:inline` prevents Astro from rewriting or de-duplicating the tag. The
script still runs only in the browser.

## Content-Security-Policy

The loader touches the host page in exactly three ways. Add the Herald origin
to the directives you already have:

```http
Content-Security-Policy:
  script-src 'self' https://herald.example.com;
  style-src 'self' https://herald.example.com;
  frame-src https://herald.example.com;
```

There is no `unsafe-inline` requirement: the script is an external file and
the stylesheet is loaded as a separate file into the launcher's shadow root.
If your `script-src` uses nonces, add `data-nonce="<per-response-nonce>"` to
the tag and the loader copies it to the stylesheet link. Herald manages
`frame-ancestors` for the embed; your policy only decides which frames your
own page may embed. `connect-src` is not needed by the launcher, because its
network calls run inside the iframe under Herald's origin.

## Identifying the signed-in customer

When your own sign-in completes, hand over a backend-signed HS256 JWT:

```ts
await window.HeraldWidget?.identify(signedToken);
```

The token needs `sub`, `iss`, `aud`, `iat` and `exp`, expires in at most one
hour, and is signed with the workspace signing secret. Never mint it in the
browser. `HeraldWidget.logout()` clears the shared customer session. An
invalid or expired token fails closed.

## If the panel does not appear

- **404 inside the frame** — the key or the embedding origin is not allowed.
  Re-copy the key and add the exact origin under **Allowed origins**.
- **Empty frame or a "Try again" message** — the embed did not answer the state
  handshake within 12 seconds, the page is offline, or the iframe cannot write
  a session cookie because of third-party cookie blocking. The message offers
  **Try again** and **Open in a new tab**.
- **Screenshot button unavailable** — the host page sends its own
  `Permissions-Policy` without `display-capture`. Add
  `display-capture=(self "https://herald.example.com")`, or use paste/file
  upload instead.
- **Nothing at all** — check the console for a blocked script. A policy that
  omits the Herald origin in `script-src` or a `default-src` fallback prevents
  the loader from running.

## Verifying the install

Return to **Widget → Installation check**. It verifies the public surface,
the key and the saved origin rather than only checking that a URL returns
`200`. The manual browser matrix — focus, reduced motion, blocked cookies and
the offline states — is documented for release testing; the automated matrix
runs the shipped loader in Chromium, Firefox and WebKit.
