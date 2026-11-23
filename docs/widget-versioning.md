# Widget versioning and the v1 → v2 upgrade path

The widget has two independently versioned pieces:

| Piece | Current value | Where it lives |
| --- | --- | --- |
| Loader URL | `v1` | `/widget/v1.js`, `/widget/v1.css` |
| Loader/frame handshake | `1` | `HeraldWidget.protocol`, the embed postMessage contract |
| Snippet cache key | `v=6` | `src` query in the dashboard snippet |

`HeraldWidget.version` is the major URL (`"v1"`). The handshake revision is a
number so a future loader can accept an older frame without parsing a string.
Both are observable from the host page:

```js
HeraldWidget.version; // "v1"
HeraldWidget.protocol; // 1
```

## What may change under `v1.js`

The URL is served `Cache-Control: public, max-age=31536000, immutable`, so a
cached copy never changes. The dashboard snippet adds a cache key
(`/widget/v1.js?v=6`); when a release changes the loader, the key is bumped and
a copied snippet fetches the new bytes while old pages keep the version they
already downloaded.

Allowed under the same major version:

- bug fixes and accessibility fixes;
- new optional `data-*` attributes that default to the current behaviour;
- new `HeraldWidget` methods and events;
- additional fields in `getState()` and in the state message, as long as an old
  field keeps its meaning.

Not allowed under the same major version:

- removing or renaming a method, event, attribute or state field;
- changing what an existing method does (for example, making `open()` inline
  instead of floating);
- requiring a new attribute that an existing snippet does not have;
- changing the embed route's panel paths or postMessage `type` names.

Anything in the second list ships as `v2.js` / `v2.css` and a handshake
revision bump.

## Publishing v2

1. **Freeze v1.** Copy the current `public/widget/v1.js` and `v1.css` before
   editing. v1 continues to serve exactly those bytes.
2. **Ship v2** at `/widget/v2.js` and `/widget/v2.css`. Add the pair to the
   `next.config.ts` immutable cache headers, and add a `WIDGET_BUDGETS` entry
   before the release so the new loader cannot grow unnoticed.
3. **Keep the shared contract.** A v2 loader must still understand the v1
   frame for the overlap window, or the dashboard must pin the snippet to v1
   until every frame is v2. The supported rule is: the loader may be ahead of
   the frame, never the reverse. If the frame sees a `protocol` it does not
   support, it answers with a `degraded` message instead of rendering an empty
   panel.
4. **Warn hosts.** Three deliberate surfaces, in this order:
   - the Widget page must gain an **Update available** notice and emit the v2
     snippet (the page already renders the current loader URL and key);
   - `/widget/v1.js` and `/widget/v1.css` answer with
     `Deprecation: true` and `Sunset: <HTTP-date>` for at least one release
     window (six months is the default). A host can see the warning in the
     network panel or in an automated header check;
   - the release notes name the v2 URL, the removed behaviour and the exact
     snippet diff. Hosts that read `HeraldWidget.version` can alert on their
     own side.
5. **Retire v1** only after the sunset date and after the dashboard's snippet
   has pointed at v2 for the whole window. Removing the file makes an old
   snippet fail closed: the loader never mounts and the page is untouched,
   which is safer than silently running an unsupported contract.

### Snippet diff

Only the `src` value changes; the data attributes keep their names:

```diff
- src="https://herald.example.com/widget/v1.js?v=6"
+ src="https://herald.example.com/widget/v2.js?v=1"
```

A host that uses a custom launcher or `embed()` changes nothing else. Events
and method names stay stable within a major republish; a host that relied on a
removed v1 method gets a documented migration in the release notes, not a
runtime surprise.

### Checking an installation

```js
// In the host console after the script loads:
HeraldWidget.version;  // v1 or v2
HeraldWidget.protocol; // 1
HeraldWidget.getState(); // open, ready, mode, panel, unread, online, degraded
```

The dashboard's **Widget health** card shows the last loader version reported by
an install. A product still reporting `v1` after the upgrade window has not
copied the new snippet.

## Cache keys are not versions

`?v=6` is only a browser cache key. It is not compared by the frame and it does
not change the API. The dashboard writes the current key into the snippet
automatically; do not hand-edit it.
