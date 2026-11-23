import { slugify } from "@/lib/slug";

/**
 * Changelog tag normalization.
 *
 * Tags are product-scoped and deduplicated by slug, so "API" and "api" become
 * one reusable tag. The display name keeps the first spelling the team used.
 */

export const MAX_RELEASE_TAGS = 8;
export const MAX_RELEASE_TAG_LENGTH = 24;

export type NormalizedReleaseTag = { name: string; slug: string };

export function parseReleaseTagText(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim().replace(/\s+/g, " "))
    .filter((part) => part.length > 0);
}

export function normalizeReleaseTags(values: string[]): NormalizedReleaseTag[] {
  const tags: NormalizedReleaseTag[] = [];
  const seen = new Set<string>();

  for (const raw of values) {
    const name = raw.trim().replace(/\s+/g, " ");
    if (name.length === 0 || name.length > MAX_RELEASE_TAG_LENGTH) continue;

    const slug = slugify(name);
    if (!slug || seen.has(slug)) continue;

    seen.add(slug);
    tags.push({ name, slug });
    if (tags.length >= MAX_RELEASE_TAGS) break;
  }

  return tags;
}
