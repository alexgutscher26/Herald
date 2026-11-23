import "server-only";

import {
  getPublicChangelogPage,
  listPublicChangelogEntries,
} from "./changelog";
import {
  publicChangelogCategoryPath,
  publicChangelogEntryPath,
  publicChangelogPath,
  publicChangelogTagPath,
} from "./paths";
import type { PublicChangelogFilter } from "./types";
import { resolvePublicChangelogProduct } from "./resolver";
import { absolutePublicUrl } from "./urls";

/**
 * RSS 2.0 feed for the public changelog, optionally narrowed to one tag or
 * category. The page lookup applies the same public predicates and resolves
 * the tag, so an unknown filter is a 404 rather than an empty feed.
 */

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

const CATEGORY_LABELS = {
  feature: "Features",
  improvement: "Improvements",
  fix: "Fixes",
} as const;

function filterTitle(filter: PublicChangelogFilter | null): string | null {
  if (!filter) return null;
  return filter.kind === "tag"
    ? `Tagged ${filter.tag.name}`
    : CATEGORY_LABELS[filter.category];
}

function filterPath(
  filter: PublicChangelogFilter | null,
  workspaceSlug: string,
  productSlug: string,
): string {
  if (filter?.kind === "tag") {
    return publicChangelogTagPath(workspaceSlug, productSlug, filter.tag.slug);
  }
  if (filter?.kind === "category") {
    return publicChangelogCategoryPath(workspaceSlug, productSlug, filter.category);
  }
  return publicChangelogPath(workspaceSlug, productSlug);
}

export async function changelogRssResponse(input: {
  workspaceSlug: string;
  productSlug: string;
  tagSlug?: string;
  category?: string;
}): Promise<Response> {
  const tenant = await resolvePublicChangelogProduct(input);
  if (!tenant) return new Response("Not found", { status: 404 });

  const page = await getPublicChangelogPage(input);
  if (!page) return new Response("Not found", { status: 404 });

  const entries = await listPublicChangelogEntries(
    tenant.product.id,
    50,
    page.filter,
  );

  const listUrl = absolutePublicUrl(
    filterPath(page.filter, input.workspaceSlug, input.productSlug),
  );
  const qualifier = filterTitle(page.filter);
  const feedTitle = `${page.product.name} changelog${qualifier ? ` — ${qualifier}` : ""}`;

  const items = entries
    .map((entry) => {
      const url = absolutePublicUrl(
        publicChangelogEntryPath(input.workspaceSlug, input.productSlug, entry.slug),
      );
      return [
        "<item>",
        `<title>${xml(entry.title)}</title>`,
        `<link>${xml(url)}</link>`,
        `<guid isPermaLink="true">${xml(url)}</guid>`,
        `<pubDate>${new Date(entry.publishedAt).toUTCString()}</pubDate>`,
        `<description>${xml(entry.summary)}</description>`,
        `<category>${xml(entry.category)}</category>`,
        ...entry.tags.map((tag) => `<category>${xml(tag)}</category>`),
        "</item>",
      ].join("");
    })
    .join("");

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "<channel>",
    `<title>${xml(feedTitle)}</title>`,
    `<link>${xml(listUrl)}</link>`,
    `<description>${xml(`Product updates from ${page.product.name}.`)}</description>`,
    "<language>en</language>",
    `<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>`,
    items,
    "</channel>",
    "</rss>",
  ].join("");

  return new Response(body, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300",
    },
  });
}