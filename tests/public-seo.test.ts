import { afterEach, describe, expect, test } from "bun:test";

import robots from "@/app/robots";
import { isFilteredPublicBoardQuery, parsePublicBoardQuery } from "@/features/public/query";
import { absolutePublicUrl, publicOrigin } from "@/features/public/urls";

/**
 * SEO helpers are pure, so they are tested without a database. The origin is
 * read from the deployment's existing canonical URL rather than a new setting;
 * a malformed value must degrade safely instead of breaking a page render.
 */

const previous = process.env.BETTER_AUTH_URL;

afterEach(() => {
  if (previous === undefined) delete process.env.BETTER_AUTH_URL;
  else process.env.BETTER_AUTH_URL = previous;
});

describe("public URLs", () => {
  test("uses the deployment origin and drops a path or trailing slash", () => {
    process.env.BETTER_AUTH_URL = "https://feedback.example.com/ignored/path/";
    expect(publicOrigin()).toBe("https://feedback.example.com");
    expect(absolutePublicUrl("/p/acme/app")).toBe(
      "https://feedback.example.com/p/acme/app",
    );
    expect(absolutePublicUrl("sitemap.xml")).toBe(
      "https://feedback.example.com/sitemap.xml",
    );
  });

  test("falls back to localhost for an absent or non-http origin", () => {
    delete process.env.BETTER_AUTH_URL;
    expect(publicOrigin()).toBe("http://localhost:3000");

    process.env.BETTER_AUTH_URL = "ftp://example.com";
    expect(publicOrigin()).toBe("http://localhost:3000");

    process.env.BETTER_AUTH_URL = "not a url";
    expect(publicOrigin()).toBe("http://localhost:3000");
  });
});

describe("board indexability", () => {
  test("the clean default view is indexable", () => {
    expect(isFilteredPublicBoardQuery(parsePublicBoardQuery({}))).toBe(false);
  });

  test("search, filters, sorting and pagination are not canonical", () => {
    for (const raw of [
      { q: "billing" },
      { status: "planned" },
      { tag: "enterprise" },
      { sort: "top" },
      { page: "2" },
      { pageSize: "50" },
    ]) {
      expect(isFilteredPublicBoardQuery(parsePublicBoardQuery(raw))).toBe(true);
    }
  });
});

describe("robots", () => {
  test("points at the absolute sitemap and keeps private surfaces out", () => {
    process.env.BETTER_AUTH_URL = "https://feedback.example.com";
    const policy = robots();
    const rule = Array.isArray(policy.rules) ? policy.rules[0] : policy.rules;
    const disallow = Array.isArray(rule?.disallow) ? rule.disallow : [rule?.disallow];

    expect(policy.sitemap).toBe("https://feedback.example.com/sitemap.xml");
    expect(policy.host).toBe("https://feedback.example.com");
    expect(disallow).toContain("/app");
    expect(disallow).toContain("/api/");
    expect(disallow).toContain("/p/*/preferences");
    expect(disallow).toContain("/p/*/login");
  });
});
