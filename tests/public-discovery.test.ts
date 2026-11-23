import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";

import {
  customDomainPath,
  normalizeDomainHost,
  requestHost,
} from "@/features/public/custom-domain-path";
import {
  articleSchema,
  faqPageSchema,
  serializeJsonLd,
  softwareApplicationSchema,
} from "@/features/public/structured-data";

describe("custom-domain routing", () => {
  const route = { workspaceSlug: "acme", productSlug: "app" };

  test("normalizes only DNS hostnames", () => {
    expect(normalizeDomainHost("Feedback.Example.com:443")).toBe("feedback.example.com");
    expect(normalizeDomainHost("feedback.example.com.")).toBe("feedback.example.com");
    expect(normalizeDomainHost("localhost:3000")).toBeNull();
    expect(normalizeDomainHost("127.0.0.1")).toBeNull();
    expect(normalizeDomainHost("https://feedback.example.com")).toBeNull();
  });

  test("prefers the forwarded host", () => {
    const headers = new Headers({
      host: "internal:3000",
      "x-forwarded-host": "Feedback.Example.com, edge.internal",
    });
    expect(requestHost(headers)).toBe("feedback.example.com");
  });

  test("maps product paths but leaves app and API routes alone", () => {
    expect(customDomainPath(route, "/")).toBe("/p/acme/app");
    expect(customDomainPath(route, "/help")).toBe("/p/acme/app/help");
    expect(customDomainPath(route, "/updates/launch")).toBe("/p/acme/app/updates/launch");
    expect(customDomainPath(route, "/api/health")).toBeNull();
    expect(customDomainPath(route, "/app/acme")).toBeNull();
    expect(customDomainPath(route, "/p/acme/app")).toBeNull();
    expect(customDomainPath(route, "/_next/static/chunk.js")).toBeNull();
    expect(customDomainPath(route, "/sw.js")).toBeNull();
  });
});

describe("structured data", () => {
  test("emits the three requested schema types", () => {
    expect(softwareApplicationSchema()["@type"]).toBe("SoftwareApplication");
    expect(
      articleSchema({
        headline: "Launch",
        description: "What shipped",
        path: "/p/acme/app/updates/launch",
        datePublished: "2026-11-21T00:00:00.000Z",
        authorNames: ["Alex"],
        publisherName: "Acme",
      })["@type"],
    ).toBe("Article");
    expect(
      faqPageSchema({
        question: "How do I start?",
        answer: "Open the portal.",
        path: "/p/acme/app/help/start",
      })["@type"],
    ).toBe("FAQPage");
  });

  test("cannot close the script element from article text", () => {
    const serialized = serializeJsonLd({ text: "</script><script>alert(1)</script>" });
    expect(serialized).not.toContain("</script>");
    expect(serialized).not.toContain("<script>");
  });
});

describe("public discovery and PWA assets", () => {
  test("sitemap and llms documents include help and API documentation", () => {
    const sitemap = readFileSync("src/app/sitemap.ts", "utf8");
    const llms = readFileSync("src/features/public/llms.ts", "utf8");

    expect(sitemap).toContain("publicHelpArticlePath");
    expect(sitemap).toContain("publicApiDocPath");
    expect(llms).toContain('"## Help"');
    expect(llms).toContain('"## API documentation"');
  });

  test("manifest and install icons are present at their declared sizes", () => {
    const manifest = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8")) as {
      theme_color: string;
      icons: Array<{ src: string; sizes: string }>;
    };
    expect(manifest.theme_color).toBe("#1f6b45");

    for (const icon of manifest.icons) {
      const path = `public${icon.src}`;
      expect(statSync(path).size).toBeGreaterThan(0);
      const png = readFileSync(path);
      const width = png.readUInt32BE(16);
      const height = png.readUInt32BE(20);
      expect(`${width}x${height}`).toBe(icon.sizes);
    }

    expect(statSync("public/sw.js").size).toBeGreaterThan(0);
    expect(statSync("src/app/offline/page.tsx").size).toBeGreaterThan(0);
  });

  test("public layout declares direction and language alternates", () => {
    const layout = readFileSync("src/app/p/[workspaceSlug]/layout.tsx", "utf8");
    expect(layout).toContain("dir={PUBLIC_LOCALE_DIRECTIONS[site.locale]}");
    expect(layout).toContain('rel="alternate"');
    expect(layout).toContain('hrefLang="x-default"');
  });
});
