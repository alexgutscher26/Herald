/**
 * Pure tag-suggestion policy.
 *
 * A model may only choose tags that already exist on the request's board. The
 * normalization is deliberately strict: strip numbering, quotes and casing,
 * drop anything not in the allowlist, and cap the result.
 */

export function normalizeTagSuggestion(raw: string, allowed: string[]): string[] {
  const byLower = new Map(allowed.map((tag) => [tag.toLowerCase(), tag]));
  const cleaned = raw
    .split(/[\n,]+/)
    .map((line) =>
      line
        .replace(/^[\s\-*\d.)]+/, "")
        .replace(/[`"']/g, "")
        .trim()
        .toLowerCase(),
    )
    .filter((line) => line !== "" && line !== "none");

  const result: string[] = [];
  for (const candidate of cleaned) {
    const match = byLower.get(candidate);
    if (match && !result.includes(match)) result.push(match);
    if (result.length >= 5) break;
  }
  return result;
}
