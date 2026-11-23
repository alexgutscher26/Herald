import { describe, expect, test } from "bun:test";

import {
  parseWidgetHostOrigin,
  parseWidgetLocale,
  parseWidgetPanel,
  parseWidgetProject,
  parseWidgetTheme,
  widgetEmbedHref,
  widgetEmbedPath,
  widgetPanelSegments,
  widgetRouteFromPublicPath,
  widgetScriptPath,
} from "@/features/widget/paths";

/**
 * The loader and iframe route share this contract. These cases pin the
 * accepted project/deep-link shapes and, just as importantly, the malformed
 * values that must become a 404 or safe fallback rather than reaching a URL.
 */

describe("widget project", () => {
  test("accepts exactly workspace/product", () => {
    expect(parseWidgetProject("acme/widgets")).toEqual({
      workspaceSlug: "acme",
      productSlug: "widgets",
    });
    expect(parseWidgetProject(" acme/widgets ")).toEqual({
      workspaceSlug: "acme",
      productSlug: "widgets",
    });
  });

  test("rejects traversal, extra segments, invalid and reserved slugs", () => {
    for (const value of [
      "",
      "acme",
      "acme/widgets/extra",
      "acme/../widgets",
      "Acme/widgets",
      "app/widgets",
      "acme/widgets?x=1",
      null,
    ]) {
      expect(parseWidgetProject(value)).toBeNull();
    }
  });
});

describe("widget panel deep links", () => {
  const requestId = "00000000-0000-4000-8000-000000000001";

  test("maps every supported panel", () => {
    expect(parseWidgetPanel(undefined)).toEqual({ view: "home" });
    expect(parseWidgetPanel([])).toEqual({ view: "home" });
    expect(parseWidgetPanel(["feedback"])).toEqual({
      view: "feedback",
      boardSlug: null,
    });
    expect(parseWidgetPanel(["feedback", "requests"])).toEqual({
      view: "feedback",
      boardSlug: "requests",
    });
    expect(parseWidgetPanel(["feedback", "requests", "new"])).toEqual({
      view: "feedback",
      boardSlug: "requests",
      compose: true,
    });
    expect(parseWidgetPanel(["feedback", "requests", requestId])).toEqual({
      view: "feedback",
      boardSlug: "requests",
      requestId,
    });
    expect(parseWidgetPanel(["feedback", requestId])).toEqual({
      view: "feedback",
      boardSlug: null,
      requestId,
    });
    expect(parseWidgetPanel(["roadmap"])).toEqual({ view: "roadmap" });
    expect(parseWidgetPanel(["updates"])).toEqual({
      view: "updates",
      slug: null,
    });
    expect(parseWidgetPanel(["updates", "faster-search"])).toEqual({
      view: "updates",
      slug: "faster-search",
    });
    expect(parseWidgetPanel(["messages"])).toEqual({ view: "messages" });
    expect(parseWidgetPanel(["notifications"])).toEqual({
      view: "notifications",
    });
  });

  test("rejects unknown, extra and malformed segments", () => {
    for (const segments of [
      ["unknown"],
      ["updates", "one", "two"],
      ["feedback", "requests", "not-a-uuid"],
      ["feedback", "Bad Board"],
      ["roadmap", "extra"],
      ["home", "extra"],
      ["updates", "UPPER"],
    ]) {
      expect(parseWidgetPanel(segments)).toBeNull();
    }
  });

  test("serializes the route the iframe bridge reports to the host", () => {
    expect(widgetPanelSegments({ view: "home" })).toEqual([]);
    expect(widgetPanelSegments({ view: "roadmap" })).toEqual(["roadmap"]);
    expect(widgetPanelSegments({ view: "updates", slug: null })).toEqual([
      "updates",
    ]);
    expect(widgetPanelSegments({ view: "updates", slug: "faster-search" })).toEqual([
      "updates",
      "faster-search",
    ]);
    expect(
      widgetPanelSegments({
        view: "feedback",
        boardSlug: "requests",
        requestId,
      }),
    ).toEqual(["feedback", "requests", requestId]);
  });

  test("builds encoded iframe paths and preserves display options", () => {
    expect(widgetEmbedPath("acme", "widgets")).toBe("/p/acme/widgets/embed");
    expect(
      widgetEmbedPath("acme", "widgets", {
        view: "updates",
        slug: "faster search",
      }),
    ).toBe("/p/acme/widgets/embed/updates/faster%20search");
    expect(
      widgetEmbedHref(
        "acme",
        "widgets",
        { view: "feedback", boardSlug: "requests", requestId },
        {
          theme: "dark",
          locale: "es",
          host: "https://customer.example",
        },
      ),
    ).toBe(
      `/p/acme/widgets/embed/feedback/requests/${requestId}?theme=dark&locale=es&host=https%3A%2F%2Fcustomer.example`,
    );
  });

  test("maps public notification paths back into the iframe", () => {
    expect(
      widgetRouteFromPublicPath(
        "acme",
        "widgets",
        `/p/acme/widgets/requests/${requestId}`,
      ),
    ).toEqual({ view: "feedback", boardSlug: "requests", requestId });
    expect(
      widgetRouteFromPublicPath(
        "acme",
        "widgets",
        "/p/acme/widgets/updates/faster-search",
      ),
    ).toEqual({ view: "updates", slug: "faster-search" });
    expect(
      widgetRouteFromPublicPath("acme", "widgets", "/p/other/widgets/updates"),
    ).toBeNull();
  });
});

describe("widget options", () => {
  test("only accepts known themes and locales", () => {
    expect(parseWidgetTheme("dark")).toBe("dark");
    expect(parseWidgetTheme("sepia")).toBeNull();
    expect(parseWidgetLocale("es")).toBe("es");
    expect(parseWidgetLocale("fr")).toBeNull();
  });

  test("accepts an origin, not a path or javascript URL", () => {
    expect(parseWidgetHostOrigin("https://customer.example")).toBe(
      "https://customer.example",
    );
    expect(parseWidgetHostOrigin("https://customer.example/path")).toBeNull();
    expect(parseWidgetHostOrigin("javascript:alert(1)")).toBeNull();
    expect(parseWidgetHostOrigin("not a url")).toBeNull();
  });

  test("versioned asset names are stable", () => {
    expect(widgetScriptPath()).toBe("/widget/v1.js");
  });
});
