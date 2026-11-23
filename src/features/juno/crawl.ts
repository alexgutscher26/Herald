import { lookup } from "node:dns/promises";

import { decodeEntities, normalizeText, stripHtml } from "./text";

/**
 * A deliberately small, same-origin crawler.
 *
 * Every URL — the seed, every link and every redirect hop — is revalidated
 * before it is fetched: http(s) only, no credentials, no private or loopback
 * address (IPv4, IPv6 and IPv4-mapped forms), and no DNS answer inside a
 * private range. Fetches use `redirect: "manual"` so a public URL cannot bounce
 * the crawler into the metadata service. Pages are capped by count, bytes and
 * wall-clock time, and only HTML/plain text is read.
 */

export const CRAWL_MAX_PAGES = 25;
export const CRAWL_MAX_PAGE_BYTES = 2 * 1024 * 1024;
export const CRAWL_MAX_TOTAL_BYTES = 8 * 1024 * 1024;
export const CRAWL_TIMEOUT_MS = 45_000;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;

export type CrawlPage = { url: string; title: string; content: string };

export type FetchLike = (
  input: URL | RequestInfo,
  init?: RequestInit,
) => Promise<Response>;

export type CrawlOptions = {
  maxPages?: number | undefined;
  signal?: AbortSignal | undefined;
  fetchImpl?: FetchLike;
  resolve?: (hostname: string) => Promise<string[]>;
  now?: () => number;
};

export class CrawlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrawlError";
  }
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [a = 0, b = 0] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function isPrivateAddress(address: string): boolean {
  let value = address.trim().toLowerCase();
  if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);
  const zone = value.indexOf("%");
  if (zone !== -1) value = value.slice(0, zone);

  if (value === "" || value === "localhost") return true;
  if (value.endsWith(".localhost") || value.endsWith(".local")) return true;

  if (value.includes(":")) {
    // IPv4-mapped IPv6, e.g. ::ffff:127.0.0.1
    const mapped = value.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mapped?.[1]) return isPrivateIpv4(mapped[1]);

    return (
      value === "::" ||
      value === "::1" ||
      value.startsWith("fc") ||
      value.startsWith("fd") ||
      value.startsWith("fe8") ||
      value.startsWith("fe9") ||
      value.startsWith("fea") ||
      value.startsWith("feb")
    );
  }

  return isPrivateIpv4(value);
}

async function defaultResolve(hostname: string): Promise<string[]> {
  const answers = await lookup(hostname, { all: true, verbatim: true });
  return answers.map((answer) => answer.address);
}

export async function assertCrawlableUrl(
  raw: string | URL,
  resolve: (hostname: string) => Promise<string[]> = defaultResolve,
): Promise<URL> {
  let url: URL;
  try {
    url = raw instanceof URL ? new URL(raw.toString()) : new URL(raw);
  } catch {
    throw new CrawlError("That is not a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CrawlError("Only http and https URLs can be crawled.");
  }
  if (url.username !== "" || url.password !== "") {
    throw new CrawlError("URLs with embedded credentials cannot be crawled.");
  }
  if (url.port !== "" && url.port !== "80" && url.port !== "443") {
    throw new CrawlError("Only the standard http and https ports can be crawled.");
  }
  if (isPrivateAddress(url.hostname)) {
    throw new CrawlError("That address is not publicly reachable.");
  }

  let addresses: string[];
  try {
    addresses = await resolve(url.hostname);
  } catch {
    throw new CrawlError("That host could not be resolved.");
  }
  if (addresses.length === 0) {
    throw new CrawlError("That host could not be resolved.");
  }
  if (addresses.some((address) => isPrivateAddress(address))) {
    throw new CrawlError("That address is not publicly reachable.");
  }

  url.hash = "";
  return url;
}

export function pathPrefixFor(pathname: string): string {
  if (pathname === "" || pathname === "/") return "/";
  if (pathname.endsWith("/")) return pathname;
  const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
  return lastSegment.includes(".")
    ? pathname.slice(0, pathname.length - lastSegment.length)
    : `${pathname}/`;
}

function sameSite(url: URL, seed: URL, prefix: string): boolean {
  if (url.origin !== seed.origin) return false;
  if (url.pathname === seed.pathname) return true;
  return url.pathname.startsWith(prefix);
}

function extractLinks(html: string): string[] {
  const links: string[] = [];
  const pattern = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const href = match[1];
    if (href && !href.startsWith("#") && !href.startsWith("mailto:")) {
      links.push(href);
    }
  }
  return links;
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) return null;
  const title = normalizeText(decodeEntities(match[1].replace(/<[^>]+>/g, " ")));
  return title === "" ? null : title.slice(0, 200);
}

async function readLimited(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const declared = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > maxBytes) return null;

  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    return buffer.byteLength > maxBytes ? null : buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

async function fetchPage(
  url: URL,
  seed: URL,
  prefix: string,
  options: Required<Pick<CrawlOptions, "fetchImpl" | "resolve">> & CrawlOptions,
): Promise<{ url: URL; html: string } | null> {
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertCrawlableUrl(current, options.resolve);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const response = await options.fetchImpl(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
          "user-agent": "HeraldJunoCrawler/1.0 (+https://herald.app)",
        },
        cache: "no-store",
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return null;
        const next = new URL(location, current);
        if (!sameSite(next, seed, prefix)) {
          throw new CrawlError("The page redirected outside the allowed path.");
        }
        current = next;
        continue;
      }

      if (!response.ok) return null;

      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (
        !contentType.includes("text/html") &&
        !contentType.includes("text/plain") &&
        !contentType.includes("application/xhtml")
      ) {
        return null;
      }

      const body = await readLimited(response, CRAWL_MAX_PAGE_BYTES);
      if (!body) return null;

      const html = new TextDecoder("utf-8").decode(body);
      return { url: current, html };
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
    }
  }

  return null;
}

export async function crawlPages(
  startUrl: string | URL,
  options: CrawlOptions = {},
): Promise<CrawlPage[]> {
  const seed = await assertCrawlableUrl(startUrl, options.resolve);
  const prefix = pathPrefixFor(seed.pathname);
  const maxPages = Math.min(
    Math.max(options.maxPages ?? CRAWL_MAX_PAGES, 1),
    CRAWL_MAX_PAGES,
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const resolve = options.resolve ?? defaultResolve;
  const clock = options.now ?? Date.now;
  const startedAt = clock();

  const queue: URL[] = [seed];
  const visited = new Set<string>([seed.toString()]);
  const pages: CrawlPage[] = [];
  let totalBytes = 0;

  while (queue.length > 0 && pages.length < maxPages) {
    if (clock() - startedAt > CRAWL_TIMEOUT_MS) break;

    const next = queue.shift();
    if (!next) break;

    let fetched: { url: URL; html: string } | null;
    try {
      fetched = await fetchPage(next, seed, prefix, {
        fetchImpl,
        resolve,
        signal: options.signal,
      });
    } catch (error) {
      if (error instanceof CrawlError) throw error;
      continue;
    }

    if (!fetched) continue;

    const content = stripHtml(fetched.html);
    if (content === "") continue;

    totalBytes += new TextEncoder().encode(content).byteLength;
    if (totalBytes > CRAWL_MAX_TOTAL_BYTES) break;

    pages.push({
      url: fetched.url.toString(),
      title: extractTitle(fetched.html) ?? fetched.url.pathname,
      content,
    });

    for (const href of extractLinks(fetched.html)) {
      let link: URL;
      try {
        link = new URL(href, fetched.url);
      } catch {
        continue;
      }
      link.hash = "";
      if (!sameSite(link, seed, prefix)) continue;
      const key = link.toString();
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push(link);
    }
  }

  if (pages.length === 0) {
    throw new CrawlError("No readable pages were found at that URL.");
  }

  return pages;
}
