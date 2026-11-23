/**
 * Shipped-size budgets.
 *
 * The widget loader is served to every visitor of every embedding site, and the
 * dashboard bundle is downloaded on every operator navigation. These ceilings
 * make growth a deliberate decision instead of a side effect.
 *
 * Update a number only with a measurement and a reason, never to make a red
 * check green.
 */

export type FileBudget = {
  file: string;
  rawBytes: number;
  gzipBytes: number;
};

/** Files served from `public/`, checked byte-for-byte and gzipped. */
export const WIDGET_BUDGETS: FileBudget[] = [
  // Raised deliberately with the nonce, live-region, degraded-state and
  // per-origin override work; the gzip ceiling is the number that matters to
  // a host page. Measure before changing it again.
  { file: "public/widget/v1.js", rawBytes: 54 * 1024, gzipBytes: 13 * 1024 },
  { file: "public/widget/v1.css", rawBytes: 10 * 1024, gzipBytes: 3 * 1024 },
];

/**
 * First open, measured as what the host must download before the panel is
 * usable: the loader, its stylesheet and the first panel's server-rendered
 * markup. The panel's Next.js chunks are not included; this guards the
 * per-install payload that grows when a helper or a wrapper is added to the
 * launcher or the panel chrome.
 */
export const WIDGET_FIRST_PANEL_BUDGET = {
  rawBytes: 72 * 1024,
  gzipBytes: 20 * 1024,
};

/**
 * Dashboard client bundle, measured from the production build's client
 * reference manifests. Chunks are gzipped individually and summed, which
 * mirrors what the browser downloads.
 *
 * `route` is the feedback page (the largest dashboard route); `all` is the
 * union of every dashboard route, which is the ceiling for adding a new page.
 * `css` is the stylesheet payload for the feedback route.
 */
export const DASHBOARD_BUDGETS = {
  routeJsGzipBytes: 150 * 1024,
  allJsGzipBytes: 560 * 1024,
  routeCssGzipBytes: 24 * 1024,
};
