import { describe, expect, test } from "bun:test";

import {
  assertCrawlableUrl,
  crawlPages,
  CrawlError,
  isPrivateAddress,
  pathPrefixFor,
} from "@/features/juno/crawl";

const publicResolve = async () => ["93.184.216.34"];

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

describe("SSRF guard", () => {
  test("recognises private, loopback, link-local and mapped addresses", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.20.0.1",
      "192.168.1.10",
      "169.254.169.254",
      "0.0.0.0",
      "::1",
      "::",
      "fc00::1",
      "fd12::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "localhost",
      "docs.localhost",
      "printer.local",
    ]) {
      expect(isPrivateAddress(address)).toBe(true);
    }

    for (const address of ["8.8.8.8", "93.184.216.34", "172.32.0.1", "2606:4700::1111"]) {
      expect(isPrivateAddress(address)).toBe(false);
    }
  });

  test("refuses unsupported protocols, credentials, odd ports and private hosts", async () => {
    const cases = [
      "file:///etc/passwd",
      "ftp://example.com/docs",
      "https://user:pass@example.com/docs",
      "https://example.com:8080/docs",
      "http://127.0.0.1/docs",
      "http://169.254.169.254/latest/meta-data",
      "http://localhost:3000/docs",
    ];
    for (const value of cases) {
      await expect(assertCrawlableUrl(value, publicResolve)).rejects.toBeInstanceOf(CrawlError);
    }
  });

  test("refuses a public hostname that resolves to a private address", async () => {
    const rebinding = async () => ["10.0.0.5"];
    await expect(
      assertCrawlableUrl("https://docs.example.com/help", rebinding),
    ).rejects.toThrow("publicly reachable");
  });

  test("accepts a public https URL and strips the fragment", async () => {
    const url = await assertCrawlableUrl(
      "https://docs.example.com/help#install",
      publicResolve,
    );
    expect(url.toString()).toBe("https://docs.example.com/help");
  });

  test("derives the crawl prefix from the seed path", () => {
    expect(pathPrefixFor("/docs")).toBe("/docs/");
    expect(pathPrefixFor("/docs/")).toBe("/docs/");
    expect(pathPrefixFor("/docs/start.html")).toBe("/docs/");
    expect(pathPrefixFor("/")).toBe("/");
  });
});

describe("same-origin crawling", () => {
  test("follows links under the seed path, strips markup and ignores the rest", async () => {
    const requested: string[] = [];
    const pages = new Map<string, Response>([
      [
        "https://docs.example.com/docs",
        htmlResponse(
          `<title>Docs</title><p>Welcome to the docs.</p>
           <a href="/docs/setup">Setup</a>
           <a href="/pricing">Pricing</a>
           <a href="https://evil.example.net/docs">Elsewhere</a>
           <a href="#top">Top</a>`,
        ),
      ],
      [
        "https://docs.example.com/docs/setup",
        htmlResponse("<title>Setup</title><p>Install the CLI with npm.</p>"),
      ],
      ["https://docs.example.com/pricing", htmlResponse("<p>Do not crawl me.</p>")],
    ]);

    const fetchImpl = async (input: URL | RequestInfo) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requested.push(url);
      return pages.get(url) ?? new Response("not found", { status: 404 });
    };

    const result = await crawlPages("https://docs.example.com/docs", {
      fetchImpl,
      resolve: publicResolve,
    });

    expect(result).toHaveLength(2);
    expect(result.map((page) => page.url).sort()).toEqual([
      "https://docs.example.com/docs",
      "https://docs.example.com/docs/setup",
    ]);
    expect(result[0]?.title).toBe("Docs");
    expect(result[0]?.content).toContain("Welcome to the docs.");
    expect(result[1]?.content).toContain("Install the CLI");
    expect(requested).not.toContain("https://docs.example.com/pricing");
    expect(requested).not.toContain("https://evil.example.net/docs");
  });

  test("rejects a redirect into a private address", async () => {
    const fetchImpl = async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data" },
      });

    // The hop is refused for being outside the allowed origin before it is
    // even resolved; either guard message is an acceptable refusal.
    await expect(
      crawlPages("https://docs.example.com/docs", {
        fetchImpl,
        resolve: publicResolve,
      }),
    ).rejects.toThrow(/outside the allowed path|publicly reachable/);
  });

  test("skips non-text responses and errors when nothing readable remains", async () => {
    const fetchImpl = async () =>
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } });

    await expect(
      crawlPages("https://docs.example.com/docs", {
        fetchImpl,
        resolve: publicResolve,
      }),
    ).rejects.toThrow("No readable pages");
  });

  test("honours the page cap", async () => {
    let counter = 0;
    const fetchImpl = async (input: URL | RequestInfo) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      counter += 1;
      const next = Number(new URL(url).searchParams.get("n") ?? "0") + 1;
      return htmlResponse(
        `<p>Page ${counter}</p><a href="/docs?n=${next}">Next</a>`,
      );
    };

    const pages = await crawlPages("https://docs.example.com/docs", {
      fetchImpl,
      resolve: publicResolve,
      maxPages: 2,
    });
    expect(pages).toHaveLength(2);
  });
});
