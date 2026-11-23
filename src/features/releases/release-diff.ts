import { formatDateTime } from "@/lib/format";

import type { ReleaseRevisionSnapshot } from "./revision-types";

/**
 * Field-level diff between two release snapshots.
 *
 * Pure and client-safe: the editor diffs its unsaved working copy against a
 * stored revision, while the publish review diffs the pending save against the
 * last published revision. Both use this single implementation so a "no
 * changes" answer always means the same thing.
 */

export type ReleaseBodyDiffLine = {
  type: "same" | "added" | "removed";
  text: string;
  /** Word-level tokens for a changed line. */
  words?: ReleaseWordToken[];
};

export type ReleaseWordToken = {
  type: "same" | "added" | "removed";
  text: string;
};

export type ReleaseFieldChange = {
  field: keyof ReleaseRevisionSnapshot;
  label: string;
  before: string;
  after: string;
  /** Present when the body changed; common prefix/suffix are trimmed. */
  body?: { lines: ReleaseBodyDiffLine[]; truncated: boolean };
};

export type ReleaseDiffContext = {
  timeZone: string;
  authorName?: (id: string) => string | undefined;
  feedbackTitle?: (id: string) => string | undefined;
  cancellationReason?: (id: string) => string | undefined;
};

const CATEGORY_LABELS: Record<string, string> = {
  feature: "Feature",
  improvement: "Improvement",
  fix: "Fix",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  published: "Published",
  archived: "Archived",
};

const COVER_PRESET_LABELS: Record<string, string> = {
  grid: "Grid",
  orbit: "Orbit",
  waves: "Waves",
  plain: "Solid",
};

function formatCover(cover: ReleaseRevisionSnapshot["cover"]): string {
  if (cover.kind === "none") return "No cover";
  if (cover.kind === "custom") return "Custom image";
  return `Preset · ${COVER_PRESET_LABELS[cover.preset] ?? cover.preset}`;
}

const CHANNEL_LABELS = [
  ["publicChangelog", "Public changelog"],
  ["inAppWidget", "In-app widget"],
  ["subscriberEmail", "Subscriber email"],
] as const;

function formatChannels(channels: ReleaseRevisionSnapshot["channels"]): string {
  const enabled = CHANNEL_LABELS.filter(([key]) => channels[key]).map(([, label]) => label);
  return enabled.length > 0 ? enabled.join(" · ") : "No channels";
}

function formatTags(tags: string[]): string {
  return tags.length > 0 ? tags.join(", ") : "No tags";
}

function formatPeople(ids: string[], resolve?: (id: string) => string | undefined): string {
  if (ids.length === 0) return "No authors";
  return ids.map((id) => resolve?.(id) ?? "Unknown author").join(", ");
}

function formatMatches(
  ids: string[],
  resolve: ((id: string) => string | undefined) | undefined,
  empty: string,
  fallback: string,
): string {
  if (ids.length === 0) return empty;
  const labels = ids.slice(0, 3).map((id) => resolve?.(id) ?? fallback);
  const remaining = ids.length - labels.length;
  return remaining > 0 ? `${labels.join(", ")} +${remaining} more` : labels.join(", ");
}

function formatDate(iso: string | null, timeZone: string, empty: string): string {
  return iso ? formatDateTime(iso, timeZone) : empty;
}

function formatTranslations(translations: ReleaseRevisionSnapshot["translations"]): string {
  const spanish = translations.es;
  return spanish ? `Español · ${spanish.title}` : "No translations";
}

/** Longest-common-subsequence line diff over the changed middle section. */
function lineDiff(before: string[], after: string[]): ReleaseBodyDiffLine[] {
  const rows = before.length;
  const columns = after.length;

  if (rows === 0) return after.map((text) => ({ type: "added", text }));
  if (columns === 0) return before.map((text) => ({ type: "removed", text }));
  if (rows * columns > 60_000) {
    return [
      ...before.map((text) => ({ type: "removed" as const, text })),
      ...after.map((text) => ({ type: "added" as const, text })),
    ];
  }

  const table = Array.from({ length: rows + 1 }, () => new Uint32Array(columns + 1));
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      table[i]![j] =
        before[i] === after[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  const lines: ReleaseBodyDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < columns) {
    if (before[i] === after[j]) {
      lines.push({ type: "same", text: before[i]! });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      lines.push({ type: "removed", text: before[i]! });
      i += 1;
    } else {
      lines.push({ type: "added", text: after[j]! });
      j += 1;
    }
  }
  while (i < rows) {
    lines.push({ type: "removed", text: before[i]! });
    i += 1;
  }
  while (j < columns) {
    lines.push({ type: "added", text: after[j]! });
    j += 1;
  }
  return lines;
}

function wordTokens(text: string): string[] {
  return text.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]+/gu) ?? [];
}

/** Word-level diff over one changed line, preserving whitespace and punctuation. */
export function wordDiff(before: string, after: string): ReleaseWordToken[] {
  const left = wordTokens(before);
  const right = wordTokens(after);
  const rows = left.length;
  const columns = right.length;

  if (rows === 0) return right.map((text) => ({ type: "added", text }));
  if (columns === 0) return left.map((text) => ({ type: "removed", text }));
  if (rows * columns > 40_000) {
    return [
      ...left.map((text) => ({ type: "removed" as const, text })),
      ...right.map((text) => ({ type: "added" as const, text })),
    ];
  }

  const table = Array.from({ length: rows + 1 }, () => new Uint32Array(columns + 1));
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      table[i]![j] =
        left[i] === right[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  const tokens: ReleaseWordToken[] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < columns) {
    if (left[i] === right[j]) {
      tokens.push({ type: "same", text: left[i]! });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      tokens.push({ type: "removed", text: left[i]! });
      i += 1;
    } else {
      tokens.push({ type: "added", text: right[j]! });
      j += 1;
    }
  }
  while (i < rows) {
    tokens.push({ type: "removed", text: left[i]! });
    i += 1;
  }
  while (j < columns) {
    tokens.push({ type: "added", text: right[j]! });
    j += 1;
  }
  return tokens;
}

/** Pair consecutive removed/added lines and attach word-level tokens. */
function annotateWordDiff(lines: ReleaseBodyDiffLine[]): ReleaseBodyDiffLine[] {
  const next = lines.map((line) => ({ ...line }));
  let index = 0;
  while (index < next.length) {
    const line = next[index]!;
    if (line.type !== "removed") {
      if (line.type === "added") {
        line.words = wordTokens(line.text).map((text) => ({ type: "added", text }));
      }
      index += 1;
      continue;
    }

    let removedEnd = index;
    while (removedEnd < next.length && next[removedEnd]!.type === "removed") removedEnd += 1;
    let addedEnd = removedEnd;
    while (addedEnd < next.length && next[addedEnd]!.type === "added") addedEnd += 1;

    const removed = next.slice(index, removedEnd);
    const added = next.slice(removedEnd, addedEnd);
    const paired = Math.min(removed.length, added.length);
    for (let offset = 0; offset < paired; offset += 1) {
      const before = removed[offset]!;
      const after = added[offset]!;
      const words = wordDiff(before.text, after.text);
      before.words = words
        .filter((word) => word.type !== "added")
        .map((word) => ({
          type: word.type === "same" ? "same" : "removed",
          text: word.text,
        }));
      after.words = words
        .filter((word) => word.type !== "removed")
        .map((word) => ({
          type: word.type === "same" ? "same" : "added",
          text: word.text,
        }));
    }
    for (const line of removed.slice(paired)) {
      line.words = wordTokens(line.text).map((text) => ({ type: "removed", text }));
    }
    for (const line of added.slice(paired)) {
      line.words = wordTokens(line.text).map((text) => ({ type: "added", text }));
    }
    index = addedEnd;
  }
  return next;
}

const MAX_BODY_DIFF_LINES = 300;

function diffBody(
  before: string,
  after: string,
): { lines: ReleaseBodyDiffLine[]; truncated: boolean } {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");

  let prefix = 0;
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix]! === afterLines[afterLines.length - 1 - suffix]!
  ) {
    suffix += 1;
  }

  const beforeMiddle = beforeLines.slice(prefix, beforeLines.length - suffix);
  const afterMiddle = afterLines.slice(prefix, afterLines.length - suffix);

  // Keep a little context when the change is not at the very start/end.
  const leadingContext = beforeLines.slice(Math.max(0, prefix - 2), prefix);
  const trailingContext = beforeLines.slice(
    beforeLines.length - suffix,
    Math.min(beforeLines.length, beforeLines.length - suffix + 2),
  );

  const middle = annotateWordDiff(lineDiff(beforeMiddle, afterMiddle));
  const all: ReleaseBodyDiffLine[] = [
    ...leadingContext.map((text) => ({ type: "same" as const, text })),
    ...middle,
    ...trailingContext.map((text) => ({ type: "same" as const, text })),
  ];

  return {
    lines: all.slice(0, MAX_BODY_DIFF_LINES),
    truncated: all.length > MAX_BODY_DIFF_LINES,
  };
}

export function diffReleaseSnapshots(
  before: ReleaseRevisionSnapshot,
  after: ReleaseRevisionSnapshot,
  context: ReleaseDiffContext,
): ReleaseFieldChange[] {
  const changes: ReleaseFieldChange[] = [];
  const add = (
    field: keyof ReleaseRevisionSnapshot,
    label: string,
    beforeText: string,
    afterText: string,
  ) => {
    if (beforeText !== afterText) {
      changes.push({ field, label, before: beforeText, after: afterText });
    }
  };

  const titleBefore = before.title.trim();
  const titleAfter = after.title.trim();
  add("title", "Title", titleBefore, titleAfter);
  add("slug", "Slug", before.slug, after.slug);
  add("summary", "Summary", before.summary.trim(), after.summary.trim());

  if (before.body !== after.body) {
    changes.push({
      field: "body",
      label: "Body",
      before: `${before.body.trim() ? before.body.trim().split(/\s+/).length : 0} words`,
      after: `${after.body.trim() ? after.body.trim().split(/\s+/).length : 0} words`,
      body: diffBody(before.body, after.body),
    });
  }

  if (JSON.stringify(before.translations) !== JSON.stringify(after.translations)) {
    changes.push({
      field: "translations",
      label: "Translations",
      before: formatTranslations(before.translations),
      after: formatTranslations(after.translations),
    });
  }

  add(
    "category",
    "Category",
    CATEGORY_LABELS[before.category] ?? before.category,
    CATEGORY_LABELS[after.category] ?? after.category,
  );
  if (
    before.cover.kind === "custom" &&
    after.cover.kind === "custom" &&
    before.cover.fingerprint !== after.cover.fingerprint
  ) {
    changes.push({
      field: "cover",
      label: "Cover",
      before: "Custom image",
      after: "Custom image (replaced)",
    });
  } else {
    add("cover", "Cover", formatCover(before.cover), formatCover(after.cover));
  }
  add(
    "ogImageKey",
    "Social image",
    before.ogImageKey ? "Uploaded image" : "Generated card",
    after.ogImageKey ? "Uploaded image" : "Generated card",
  );
  add("youtubeUrl", "YouTube video", before.youtubeUrl ?? "None", after.youtubeUrl ?? "None");
  add(
    "channels",
    "Distribution",
    formatChannels(before.channels),
    formatChannels(after.channels),
  );
  add("tags", "Tags", formatTags(before.tags), formatTags(after.tags));
  add(
    "authorIds",
    "Authors",
    formatPeople(before.authorIds, context.authorName),
    formatPeople(after.authorIds, context.authorName),
  );
  add(
    "linkedFeedbackIds",
    "Linked feedback",
    formatMatches(
      before.linkedFeedbackIds,
      context.feedbackTitle,
      "No linked requests",
      "Linked request",
    ),
    formatMatches(
      after.linkedFeedbackIds,
      context.feedbackTitle,
      "No linked requests",
      "Linked request",
    ),
  );
  add(
    "linkedCancellationReasonIds",
    "Cancellation reasons",
    formatMatches(
      before.linkedCancellationReasonIds,
      context.cancellationReason,
      "No linked reasons",
      "Linked reason",
    ),
    formatMatches(
      after.linkedCancellationReasonIds,
      context.cancellationReason,
      "No linked reasons",
      "Linked reason",
    ),
  );
  add(
    "status",
    "Status",
    STATUS_LABELS[before.status] ?? before.status,
    STATUS_LABELS[after.status] ?? after.status,
  );
  add(
    "scheduledFor",
    "Schedule",
    formatDate(before.scheduledFor, context.timeZone, "Not scheduled"),
    formatDate(after.scheduledFor, context.timeZone, "Not scheduled"),
  );
  add(
    "publishedAt",
    "Publication date",
    formatDate(before.publishedAt, context.timeZone, "Not published"),
    formatDate(after.publishedAt, context.timeZone, "Not published"),
  );

  return changes;
}

/** Labels only, for the compact pre-send summary. */
export function changedFieldLabels(changes: ReleaseFieldChange[]): string[] {
  return changes.map((change) => change.label);
}
