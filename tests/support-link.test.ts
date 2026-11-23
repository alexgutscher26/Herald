import { describe, expect, test } from "bun:test";

import { buildSupportHref } from "@/lib/support-link";

const occurredAt = new Date("2026-05-01T12:00:00.000Z");

describe("buildSupportHref", () => {
  test("routes product pages to the portal support form and prefills context", () => {
    const href = buildSupportHref({
      pathname: "/app/acme/roadmap/feedback/123?tab=activity#top",
      digest: "abc123",
      occurredAt,
    });

    expect(href.startsWith("/p/acme/roadmap/support?")).toBe(true);
    const url = new URL(href, "https://herald.app");
    expect(url.searchParams.get("subject")).toBe(
      "Herald support: error on /app/acme/roadmap/feedback/123",
    );
    const body = url.searchParams.get("body") ?? "";
    expect(body).toContain("Page: /app/acme/roadmap/feedback/123");
    expect(body).toContain("Reference: abc123");
    expect(body).toContain("Time: 2026-05-01T12:00:00.000Z");
  });

  test("keeps public portal routes on the same product", () => {
    const href = buildSupportHref({ pathname: "/p/acme/roadmap/updates/launch" });
    expect(href.startsWith("/p/acme/roadmap/support?")).toBe(true);
  });

  test("falls back to the support mailbox outside a product portal", () => {
    const href = buildSupportHref({ pathname: "/pricing", occurredAt });
    expect(href.startsWith("mailto:support@herald.app?")).toBe(true);
    const url = new URL(href);
    expect(url.searchParams.get("body")).toContain("Page: /pricing");
  });

  test("does not include error text or request data", () => {
    const href = buildSupportHref({
      pathname: "/app/acme/roadmap",
      digest: "digest-only",
      occurredAt,
    });
    const body = new URL(href, "https://herald.app").searchParams.get("body") ?? "";
    expect(body).not.toContain("SQL");
    expect(body).not.toContain("secret");
    expect(body).not.toContain("customer@example.com");
  });

  test("uses the supplied note as the closing prompt", () => {
    const href = buildSupportHref({
      pathname: "/app/acme/roadmap",
      note: "I need access to this page. What I was doing:",
      occurredAt,
    });
    const body = new URL(href, "https://herald.app").searchParams.get("body") ?? "";
    expect(body.endsWith("I need access to this page. What I was doing:")).toBe(true);
  });
});
