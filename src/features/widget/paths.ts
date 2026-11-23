import { validateSlug } from "@/lib/slug";

import { normalizeWidgetSections, type WidgetSection } from "./policy";

/**
 * Widget URL contract.
 *
 * The loader accepts one `data-project="workspace/product"` attribute and
 * turns host calls such as `open("updates/changelog-slug")` into iframe paths.
 * Parsing lives here, apart from React and the database, so the loader, the
 * embed routes and tests agree on every accepted deep link.
 */

export const WIDGET_VERSION = "v1";

export const WIDGET_PANELS = [
  "home",
  "help",
  "feedback",
  "roadmap",
  "updates",
  "messages",
  "notifications",
] as const;

export type WidgetPanelName = (typeof WIDGET_PANELS)[number];
export type WidgetTheme = "light" | "dark" | "auto";
export type WidgetLocale = "en" | "es";
export type WidgetProject = { workspaceSlug: string; productSlug: string };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type WidgetRoute =
  | { view: "home" }
  | { view: "help" }
  | {
      view: "feedback";
      boardSlug: string | null;
      requestId?: string;
      compose?: boolean;
    }
  | { view: "roadmap" }
  | { view: "updates"; slug: string | null }
  | { view: "messages" }
  | { view: "notifications" };

/**
 * Parse the single-tag project value.
 *
 * Both names go through the same slug rules as onboarding, so a malformed or
 * path-traversing value is ignored before it can become an iframe URL.
 */
export function parseWidgetProject(value: string | null | undefined): WidgetProject | null {
  if (typeof value !== "string") return null;

  const parts = value.trim().split("/");
  if (parts.length !== 2) return null;

  const [workspace, product] = parts;
  if (!workspace || !product) return null;

  const workspaceSlug = validateSlug(workspace);
  const productSlug = validateSlug(product);
  if (!workspaceSlug.ok || !productSlug.ok) return null;

  return { workspaceSlug: workspaceSlug.slug, productSlug: productSlug.slug };
}

/** Parse an optional `theme` query value. Unknown values keep the site theme. */
export function parseWidgetTheme(value: string | null | undefined): WidgetTheme | null {
  return value === "light" || value === "dark" || value === "auto" ? value : null;
}

/** Parse an optional `locale` query value. Unknown values keep the site locale. */
export function parseWidgetLocale(value: string | null | undefined): WidgetLocale | null {
  return value === "en" || value === "es" ? value : null;
}

/**
 * Parse the optional `sections` query value.
 *
 * `null` means the installation did not choose sections (legacy snippets keep
 * every available panel); an explicit empty string means the operator turned
 * every optional section off.
 */
export function parseWidgetSections(
  value: string | null | undefined,
): WidgetSection[] | null {
  if (typeof value !== "string") return null;
  return normalizeWidgetSections(value.split(",").map((part) => part.trim()));
}

/**
 * The loader passes the host page's origin so the iframe can address
 * `postMessage` to it. Only an origin is accepted; a path, query or fragment
 * is not a valid target.
 */
export function parseWidgetHostOrigin(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 300) {
    return null;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.origin !== value) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function widgetEmbedBasePath(
  workspaceSlug: string,
  productSlug: string,
): string {
  return `/p/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
    productSlug,
  )}/embed`;
}

function validSegment(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(value) || UUID_PATTERN.test(value);
}

/**
 * Parse `[...panel]` from the embed route.
 *
 * `null` means an explicitly malformed path and must become a 404. The home
 * route is represented by no segments.
 */
export function parseWidgetPanel(
  segments: string[] | undefined,
): WidgetRoute | null {
  if (!segments || segments.length === 0) return { view: "home" };
  if (segments.some((segment) => segment.length === 0 || !validSegment(segment))) {
    return null;
  }

  const [first, second, third, ...rest] = segments;
  if (rest.length > 0) return null;

  switch (first) {
    case "feedback": {
      if (!second) return { view: "feedback", boardSlug: null };
      if (second === "new") {
        return { view: "feedback", boardSlug: null, compose: true };
      }
      if (UUID_PATTERN.test(second)) {
        return { view: "feedback", boardSlug: null, requestId: second };
      }
      if (!second || !validateSlug(second).ok) return null;
      if (!third) return { view: "feedback", boardSlug: second };
      if (third === "new") {
        return { view: "feedback", boardSlug: second, compose: true };
      }
      if (!UUID_PATTERN.test(third)) return null;
      return { view: "feedback", boardSlug: second, requestId: third };
    }
    case "roadmap":
      return second ? null : { view: "roadmap" };
    case "help":
      return second ? null : { view: "help" };
    case "updates": {
      if (!second) return third ? null : { view: "updates", slug: null };
      if (third || !validateSlug(second).ok) return null;
      return { view: "updates", slug: second };
    }
    case "messages":
      return second ? null : { view: "messages" };
    case "notifications":
      return second ? null : { view: "notifications" };
    case "home":
      return second ? null : { view: "home" };
    default:
      return null;
  }
}

/** Build the path below the embed base for one route. */
export function widgetPanelSegments(route: WidgetRoute): string[] {
  switch (route.view) {
    case "home":
      return [];
    case "feedback": {
      const base = route.boardSlug
        ? ["feedback", route.boardSlug]
        : ["feedback"];
      if (route.compose) return [...base, "new"];
      if (route.requestId) return [...base, route.requestId];
      return base;
    }
    case "roadmap":
      return ["roadmap"];
    case "help":
      return ["help"];
    case "updates":
      return route.slug ? ["updates", route.slug] : ["updates"];
    case "messages":
      return ["messages"];
    case "notifications":
      return ["notifications"];
  }
}

export function widgetEmbedPath(
  workspaceSlug: string,
  productSlug: string,
  route: WidgetRoute = { view: "home" },
): string {
  const base = widgetEmbedBasePath(workspaceSlug, productSlug);
  const segments = widgetPanelSegments(route).map(encodeURIComponent);
  return segments.length === 0 ? base : `${base}/${segments.join("/")}`;
}

export type WidgetQuery = {
  theme?: WidgetTheme | null;
  locale?: WidgetLocale | null;
  host?: string | null;
  /** Public installation key; not a secret, but required once configured. */
  key?: string | null;
  /** Optional panels configured in the dashboard; omitted means legacy. */
  sections?: WidgetSection[] | null;
};

/** Keep theme, locale and the validated host origin across iframe links. */
export function widgetEmbedHref(
  workspaceSlug: string,
  productSlug: string,
  route: WidgetRoute,
  query: WidgetQuery = {},
): string {
  const params = new URLSearchParams();
  if (query.theme) params.set("theme", query.theme);
  if (query.locale) params.set("locale", query.locale);
  if (query.host) params.set("host", query.host);
  if (query.key) params.set("key", query.key);
  if (query.sections !== undefined && query.sections !== null) {
    params.set("sections", query.sections.join(","));
  }
  const search = params.toString();
  const path = widgetEmbedPath(workspaceSlug, productSlug, route);
  return search === "" ? path : `${path}?${search}`;
}

/** The tab that should be marked current for a nested route. */
export function widgetPanelName(route: WidgetRoute): WidgetPanelName {
  return route.view;
}

/**
 * Translate a public notification href into its in-widget equivalent.
 *
 * Notification rows already store tenant-scoped public paths. Keeping the
 * reader inside the iframe avoids throwing a customer out to the full site for
 * a one-line status update. Unknown paths return null and are left to the full
 * page.
 */
export function widgetRouteFromPublicPath(
  workspaceSlug: string,
  productSlug: string,
  path: string,
): WidgetRoute | null {
  const pathname = path.split(/[?#]/)[0] ?? "";
  const segments = pathname.split("/").filter(Boolean);
  if (
    segments.length < 4 ||
    segments[0] !== "p" ||
    segments[1] !== workspaceSlug ||
    segments[2] !== productSlug
  ) {
    return null;
  }

  const rest = segments.slice(3);
  if (rest[0] === "updates") {
    if (rest.length === 1) return { view: "updates", slug: null };
    if (rest.length === 2 && validateSlug(rest[1]!).ok) {
      return { view: "updates", slug: rest[1]! };
    }
    return null;
  }
  if (rest[0] === "roadmap" && rest.length === 1) {
    return { view: "roadmap" };
  }
  if (validateSlug(rest[0] ?? "").ok) {
    const boardSlug = rest[0]!;
    if (rest.length === 1) return { view: "feedback", boardSlug };
    const requestId = rest[1];
    if (rest.length === 2 && requestId && UUID_PATTERN.test(requestId)) {
      return { view: "feedback", boardSlug, requestId };
    }
    if (rest.length === 2 && requestId === "submit") {
      return { view: "feedback", boardSlug, compose: true };
    }
  }
  return null;
}

/** Public remainder used by the dashboard install snippet. */
export function widgetScriptPath(version = WIDGET_VERSION): string {
  return `/widget/${version}.js`;
}

export function widgetStylesheetPath(version = WIDGET_VERSION): string {
  return `/widget/${version}.css`;
}
