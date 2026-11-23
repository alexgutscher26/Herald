import type { ReleaseCategory, ReleaseChannels, ReleaseCover } from "@/types";
import type { ReleaseTranslations } from "@/features/i18n/content";

export type SaveReleaseInput = {
  workspaceSlug: string;
  productSlug: string;
  /** Omit to create a new release; supply an existing id to update it. */
  releaseId?: string | undefined;
  title: string;
  slug: string;
  summary: string;
  body: string;
  translations: ReleaseTranslations;
  category: ReleaseCategory;
  /** Comma-separated product-scoped tags; the server creates reusable rows. */
  tagsText: string;
  /** Workspace member ids credited on the entry, in order. */
  authorIds: string[];
  /** Optional YouTube link; normalized by the server. */
  youtubeUrl: string | null;
  cover: ReleaseCover;
  /** Uploaded Open Graph image key; null uses the generated card. */
  ogImageKey: string | null;
  channels: ReleaseChannels;
  linkedFeedbackIds: string[];
  linkedCancellationReasonIds: string[];
  destination: "draft" | "publish" | "schedule";
  scheduledFor: string | null;
};

export type ReleaseMutationInput = {
  workspaceSlug: string;
  productSlug: string;
  releaseId: string;
};

export type ReleaseMutationResult = {
  releaseId: string;
  status: "draft" | "scheduled" | "published" | "archived";
};

/** A shipped request that can seed an AI changelog draft. */
export type AiDraftCandidate = {
  id: string;
  title: string;
  voteCount: number;
  updatedAt: string;
};

export type AiDraftCreateInput = {
  workspaceSlug: string;
  productSlug: string;
  feedbackIds: string[];
  focus: string;
};

export type AiDraftRewriteInput = {
  workspaceSlug: string;
  productSlug: string;
  releaseId: string;
  focus: string;
};

export type AiDraftRewriteOutput = {
  releaseId: string;
  title: string;
  summary: string;
  body: string;
  category: ReleaseCategory;
  tags: string[];
};

export type AutosaveReleaseInput = {
  workspaceSlug: string;
  productSlug: string;
  releaseId?: string | undefined;
  title: string;
  slug: string;
  summary: string;
  body: string;
  translations: ReleaseTranslations;
  category: ReleaseCategory;
  tagsText: string;
  authorIds: string[];
  youtubeUrl: string;
  cover: ReleaseCover;
  ogImageKey: string | null;
  channels: ReleaseChannels;
  linkedFeedbackIds: string[];
  linkedCancellationReasonIds: string[];
};
