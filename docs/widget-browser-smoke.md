# Widget cross-browser smoke checklist

The widget loader is hand-written ES5-style JavaScript and the panels are
ordinary server-rendered pages, so the checks below are behavioural rather than
framework-specific. Run this matrix before a release that changes
`public/widget/v1.js`, `public/widget/v1.css` or the embed route.

Automated coverage runs the launcher contract in three engines before the
manual pass:

```bash
bun run test:unit        # path parsing, origin policy, loader/CSS and first-panel budgets
bun run test:integration # key gate, allowlist, identify origin, rate limit
bun run test:browser     # Chromium, Firefox and WebKit against a fixture origin
```

`test:browser` serves the shipped `public/widget/v1.js` and `v1.css` plus a host
page and a stub frame; it needs no database or application build. It covers the
launcher mount, open/Escape focus return, per-origin position, shadow-root live
region, reduced motion, custom trigger, inline embed, nonce propagation and the
offline fallback (30 checks), including a nonce-only `script-src`/`style-src`
response header with no CSP violations. The `browser` job in
`.github/workflows/ci.yml` runs the same command. The rows below still need a
real installation: the
real embed panels, signed identity, screenshots, polling and the allowlist/key
failure paths.

## Host page

Use a real product whose public board, roadmap and changelog each contain one
item. Create a throwaway HTML file outside the app, serve it from a second
origin, and add that origin to **Widget → Allowed origins**:

```html
<!doctype html>
<html lang="en">
  <body>
    <button id="feedback-launcher" type="button">
      Feedback <span id="feedback-unread" hidden></span>
    </button>
    <div id="herald-feedback" style="height: 560px"></div>
    <script
      async
      id="herald-widget"
      src="http://localhost:3000/widget/v1.js"
      data-project="WORKSPACE/PRODUCT"
      data-key="hpk_…"
      data-position="bottom-right"
      data-theme="auto"
      data-trigger="#feedback-launcher"
    ></script>
  </body>
</html>
```

Serve it with `bunx serve . -l 3001` (or any static server) and open
`http://localhost:3001/widget-smoke.html`. If port 3001 is not in the allowlist,
the embed route answers 404; that is the expected rejection path, not a browser
failure.

## Matrix

| Browser | Launcher + panel | Keyboard/focus | Screenshot capture | Custom trigger | Inline `embed()` + URL sync |
| --- | --- | --- | --- | --- | --- |
| Chrome latest (desktop) | | | | | |
| Edge latest (desktop) | | | | | |
| Firefox latest (desktop) | | | | | |
| Safari latest (desktop) | | | | | |
| Safari iOS current | | | | | |
| Chrome Android current | | | | | |

Record the browser version and any deviation in the cell. A blank cell means the
check was not run, not that it passed.

## What to check

1. **Launcher**: opens from the saved corner; the theme follows the snippet or
   public branding; `Escape` closes it and focus returns to the launcher.
2. **Panels**: Home, Feedback, Roadmap, Updates, Messages and Notifications
   render, and a request/update deep link survives a reload. The panel tabs keep
   `theme`, `locale`, `host` and `key` in their links.
3. **Keyboard**: `Tab` reaches the launcher; opening moves focus into the panel
   and `Tab`/`Shift+Tab` cycle inside it (wrapping at the first and last
   control) without landing on the page behind it; `Escape` and the close
   button close the panel and return focus to the launcher or the custom
   trigger. Focus is visible at every step. An inline `embed()` is part of the
   page's reading order instead: `Tab` enters it and leaves it like any other
   container.
4. **Identity**: `HeraldWidget.identify(signedToken)` signs in and reloads the
   panel; an expired or tampered token fails closed; `logout()` returns the panel
   to signed-out.
5. **Events/state**: `ready`, `open`, `close`, `unread`, `presence` and
   `statechange` fire once per transition; `getState()` matches the visible
   panel. Queued calls made before mount still run. Sign in, publish a
   changelog entry or reply to the customer in another tab, and watch the
   launcher: reopening the panel refreshes immediately, and an open panel picks
   the new count up within 30 seconds (or as soon as the tab regains focus),
   with no host page reload and one `unread`/`statechange` per change. Mark all
   read on the notifications panel drops the badge to zero.
6. **Custom trigger**: the built-in launcher is absent, `data-herald-unread` and
   `data-herald-online` update on the provided button, and clicks toggle the
   panel.
7. **Inline embed**: the iframe fills the container, `navigate()` changes panel
   and `?herald=` without an extra history entry, back/forward works, and
   `destroy()` removes the iframe and listeners.
8. **Screenshot**: **Add screenshot** offers screen capture, paste and file
   selection. Capture or attach an image, draw a box and an arrow, save it, then
   submit; the annotated PNG appears in the request attachments. Where screen
   capture is unavailable (for example an iframe without
   `allow="display-capture"`), paste/file still works.
9. **CSP**: load the host page with the policy from the widget page
   (`script-src`, `style-src`, `frame-src`, `connect-src` narrowed to the Herald
   origin). The launcher and iframe must work with no `unsafe-inline`. Repeat
   with a nonce-only `script-src`/`style-src`: the script tag needs the host's
   nonce, `data-nonce` forwards it to the stylesheet, and the console must stay
   free of CSP violations.
10. **Limits**: request a URL without `data-key`, with a wrong key, and from an
    origin outside the allowlist. Each must render the 404 page rather than a
    panel. Reload the embed repeatedly from one address and confirm the identify
    endpoint starts answering 429 after 30 attempts in a minute.
11. **Screen reader**: with VoiceOver or NVDA, focus the launcher and confirm
    the label includes the unread count. Open it, publish a changelog entry or
    write a reply in another tab, and confirm the live region announces the new
    count once — not on every poll, and not only as a visual badge. The
    automated suite proves the region exists and updates; this check proves how
    the AT announces it.
12. **Degraded states**: load the host page offline, then open it with
    third-party cookies blocked for the Herald origin. Both must show the
    explanation with **Try again** and **Open in a new tab**, never an empty
    panel. Restoring the connection and pressing **Try again** must recover.

## Performance budget

Three checks guard the loader, and the extractable parts are enforced by
`bun run test:unit`:

- **Bundle**: raw and gzip ceilings for `v1.js` and `v1.css` in
  [tests/widget-budget.test.ts](../tests/widget-budget.test.ts).
- **First payload**: loader + stylesheet + the first panel's server-rendered
  markup in
  [tests/widget-first-panel-budget.test.tsx](../tests/widget-first-panel-budget.test.tsx).
  Next.js client chunks are outside this check.
- **First open**: the loader adds no network request of its own to the host
  page, and the embed frame is already loading when the launcher mounts, so
  opening the panel only toggles visibility.

Measure the latency before a release that touches the loader:

1. Serve the host page from an origin in the allowlist and load it with a cold
   cache.
2. In the console, once the launcher is visible:

   ```js
   const host = document.querySelector("[data-herald-widget-host]");
   const frame = host.shadowRoot.querySelector("iframe");
   const button = host.shadowRoot.querySelector("button");

   // Launcher mount cost: the loader's own resource entry.
   performance.getEntriesByName(`${location.origin}/widget/v1.js`)[0];

   // First open: click to visible.
   const t0 = performance.now();
   button.click();
   ({
     clickToVisibleMs: performance.now() - t0,
     frameReady: frame.contentDocument.readyState,
   });
   ```

Record the numbers with the release; a regression is a bug, not "the network
was slow". Reference measurement on localhost: the launcher mounted about 8 ms
after the script tag ran (loader 30,991 bytes raw / 7,503 bytes gzip, fetched in
6 ms), and click to visible was about 1 ms with the frame already preloaded.
The loader has since grown with the nonce, live-region, degraded-state and
per-origin work: the current shipped file is 51,513 bytes raw / 12,381 bytes
gzip, and the CSS is 8,899 bytes raw / 2,274 bytes gzip. The ceilings in
`scripts/bundle-budgets.ts` are the authoritative numbers; re-measure the timings
rather than assuming they are unchanged. The embed frame's own load time is
dominated by the app build (Turbopack dev SSR), so measure first open as the
loader's own cost, not the frame's render.

## Recording results

Keep the filled matrix with the release notes or open issue. If a browser
cannot run one check, name the limitation explicitly (for example “Safari iOS:
screen capture unavailable; paste path verified”) instead of leaving the reader
to infer a pass.
