import type { StatusTone } from "@/components/shared/status-badge";

import type { PublicMessageKey } from "./i18n";
import type { PublicFeedbackCategory, PublicFeedbackStatus } from "./types";

/**
 * Presentation metadata for the public feedback surface.
 *
 * Labels are message keys, not English strings, so every public view renders
 * in the active locale. Tones are the shared badge vocabulary used by the
 * internal inbox too.
 */

export const PUBLIC_STATUS_LABELS: Record<PublicFeedbackStatus, PublicMessageKey> = {
  open: "common.status.open",
  under_review: "common.status.under_review",
  planned: "common.status.planned",
  in_progress: "common.status.in_progress",
  shipped: "common.status.shipped",
  closed: "common.status.closed",
};

export const PUBLIC_STATUS_TONES: Record<PublicFeedbackStatus, StatusTone> = {
  open: "info",
  under_review: "warning",
  planned: "accent",
  in_progress: "info",
  shipped: "success",
  closed: "neutral",
};

export const PUBLIC_CATEGORY_LABELS: Record<PublicFeedbackCategory, PublicMessageKey> = {
  feature_request: "common.category.feature_request",
  bug: "common.category.bug",
  improvement: "common.category.improvement",
  question: "common.category.question",
};
