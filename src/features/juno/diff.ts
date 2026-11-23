import { normalizeText } from "./text";

/** A page as it exists in a knowledge version, or as the crawler just read it. */
export type KnowledgePageSnapshot = {
  url: string | null;
  title: string;
  content: string;
};

export type KnowledgeChange = {
  added: number;
  removed: number;
  changed: number;
};

function pageKey(page: KnowledgePageSnapshot): string {
  return page.url ?? `title:${page.title}`;
}

/** Compare the live page set with the freshly crawled one. */
export function summarizeKnowledgeChange(
  previous: KnowledgePageSnapshot[],
  next: KnowledgePageSnapshot[],
): KnowledgeChange {
  const before = new Map(previous.map((page) => [pageKey(page), page]));
  const after = new Map(next.map((page) => [pageKey(page), page]));

  let added = 0;
  let removed = 0;
  let changed = 0;

  for (const [key, page] of after) {
    const old = before.get(key);
    if (!old) {
      added += 1;
      continue;
    }
    if (normalizeText(old.content) !== normalizeText(page.content)) {
      changed += 1;
    }
  }
  for (const key of before.keys()) {
    if (!after.has(key)) removed += 1;
  }

  return { added, removed, changed };
}

export function hasKnowledgeChange(change: KnowledgeChange): boolean {
  return change.added + change.removed + change.changed > 0;
}
