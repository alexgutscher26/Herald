import type {
  Release,
  ReleaseCategory,
  ReleaseChannels,
  ReleaseCover,
  ReleaseStatus,
} from "@/types";
import type { ReleaseTranslations } from "@/features/i18n/content";

import { normalizeReleaseTags, parseReleaseTagText } from "./tags";

/**
 * Shared revision shapes.
 *
 * Kept out of the server-only service so the editor, the history dialog and
 * the diff helpers can all speak the same type without importing Drizzle.
 */

export const RELEASE_REVISION_ACTIONS = [
  "autosave",
  "save",
  "publish",
  "update",
  "schedule",
  "archive",
  "restore",
] as const;

export type ReleaseRevisionAction = (typeof RELEASE_REVISION_ACTIONS)[number];

/** A cover without its uploaded image; a custom one keeps a fingerprint. */
export type ReleaseRevisionCover =
  | { kind: "preset"; preset: "grid" | "orbit" | "waves" | "plain" }
  | {
      kind: "custom";
      /** Cheap hash of the storage key; detects a replaced image. */
      fingerprint: string;
    }
  | { kind: "none" };

/**
 * Fingerprint a custom cover from its storage key.
 *
 * Every upload gets a fresh generated key, so replacing an image always
 * changes the fingerprint, and the object itself never enters a revision row.
 */
export function customCoverFingerprint(key: string): string {
  let hash = 5381;
  for (let index = 0; index < key.length; index += 1) {
    hash = ((hash << 5) + hash + key.charCodeAt(index)) | 0;
  }
  return `${key.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

export type ReleaseRevisionSnapshot = {
  title: string;
  slug: string;
  summary: string;
  body: string;
  translations: ReleaseTranslations;
  category: ReleaseCategory;
  cover: ReleaseRevisionCover;
  ogImageKey: string | null;
  youtubeUrl: string | null;
  channels: ReleaseChannels;
  tags: string[];
  authorIds: string[];
  linkedFeedbackIds: string[];
  linkedCancellationReasonIds: string[];
  status: ReleaseStatus;
  /** ISO instants, or null when the release has no schedule/publication. */
  scheduledFor: string | null;
  publishedAt: string | null;
};

export type ReleaseRevisionView = ReleaseRevisionSnapshot & {
  id: string;
  action: ReleaseRevisionAction;
  createdById: string | null;
  createdByName: string | null;
  createdAt: string;
};

function asIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Build the revision snapshot from the serializable editor/action input. */
export function snapshotFromInput(input: {
  title: string;
  slug: string;
  summary: string;
  body: string;
  translations: ReleaseTranslations;
  category: ReleaseCategory;
  cover: ReleaseCover;
  ogImageKey: string | null;
  youtubeUrl: string | null;
  channels: ReleaseChannels;
  tagsText: string;
  authorIds: string[];
  linkedFeedbackIds: string[];
  linkedCancellationReasonIds: string[];
  status: ReleaseStatus;
  scheduledFor: Date | string | null;
  publishedAt: Date | string | null;
}): ReleaseRevisionSnapshot {
  return {
    title: input.title,
    slug: input.slug,
    summary: input.summary,
    body: input.body,
    translations: input.translations,
    category: input.category,
    cover: toRevisionCover(input.cover),
    ogImageKey: input.ogImageKey,
    youtubeUrl: input.youtubeUrl,
    channels: input.channels,
    tags: normalizeReleaseTags(parseReleaseTagText(input.tagsText)).map((tag) => tag.name),
    authorIds: input.authorIds,
    linkedFeedbackIds: input.linkedFeedbackIds,
    linkedCancellationReasonIds: input.linkedCancellationReasonIds,
    status: input.status,
    scheduledFor: asIso(input.scheduledFor),
    publishedAt: asIso(input.publishedAt),
  };
}

/** Replace a custom cover with its fingerprint before it is persisted. */
export function toRevisionCover(cover: ReleaseCover): ReleaseRevisionCover {
  if (cover.kind === "preset") return { kind: "preset", preset: cover.preset };
  if (cover.kind === "custom") {
    return { kind: "custom", fingerprint: customCoverFingerprint(cover.key) };
  }
  return { kind: "none" };
}

/**
 * The revision that describes what is currently (or last was) published.
 *
 * Status alone is not enough: an autosave of a published release keeps its
 * status while changing its content. Prefer the newest explicit publish/update
 * marker, then fall back to the oldest published snapshot (the baseline
 * captured before the first post-migration edit).
 */
export function findPublicationRevision(
  revisions: ReleaseRevisionView[],
): ReleaseRevisionView | null {
  const explicit = revisions.find(
    (revision) => revision.action === "publish" || revision.action === "update",
  );
  if (explicit) return explicit;

  for (let index = revisions.length - 1; index >= 0; index -= 1) {
    const revision = revisions[index];
    if (revision?.status === "published") return revision;
  }
  return null;
}

/**
 * Snapshot the editor's current value. `previewRelease` is the same object the
 * public preview renders, so a diff can never disagree with that preview.
 */
export function snapshotFromRelease(
  release: Release,
  authorIds: string[],
): ReleaseRevisionSnapshot {
  return {
    title: release.title,
    slug: release.slug,
    summary: release.summary,
    body: release.body,
    translations: release.translations,
    category: release.category,
    cover: toRevisionCover(release.cover),
    ogImageKey: release.ogImage?.key ?? null,
    youtubeUrl: release.youtubeUrl,
    channels: release.channels,
    tags: release.tags,
    authorIds,
    linkedFeedbackIds: release.linkedFeedbackIds,
    linkedCancellationReasonIds: release.linkedCancellationReasonIds,
    status: release.status,
    scheduledFor: release.scheduledFor,
    publishedAt: release.publishedAt,
  };
}
