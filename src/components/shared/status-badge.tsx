import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  FeedbackCategory,
  FeedbackStatus,
  ReleaseCategory,
  ReleaseStatus,
} from "@/types";

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  success: "border-transparent bg-success-muted text-success",
  warning: "border-transparent bg-warning-muted text-warning",
  danger: "border-transparent bg-destructive/10 text-destructive",
  info: "border-transparent bg-info-muted text-info",
  accent: "border-transparent bg-primary/10 text-primary",
};

export function StatusBadge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: StatusTone;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap", TONE_CLASSES[tone], className)}>
      {children}
    </Badge>
  );
}

export const RELEASE_STATUS_LABELS: Record<ReleaseStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  published: "Published",
  archived: "Archived",
};

const RELEASE_STATUS_TONES: Record<ReleaseStatus, StatusTone> = {
  draft: "neutral",
  scheduled: "info",
  published: "success",
  archived: "neutral",
};

export function ReleaseStatusBadge({ status }: { status: ReleaseStatus }) {
  return <StatusBadge tone={RELEASE_STATUS_TONES[status]}>{RELEASE_STATUS_LABELS[status]}</StatusBadge>;
}

export const RELEASE_CATEGORY_LABELS: Record<ReleaseCategory, string> = {
  feature: "Feature",
  improvement: "Improvement",
  fix: "Fix",
};

export function ReleaseCategoryBadge({ category }: { category: ReleaseCategory }) {
  const tone: StatusTone = category === "feature" ? "accent" : category === "fix" ? "warning" : "neutral";
  return <StatusBadge tone={tone}>{RELEASE_CATEGORY_LABELS[category]}</StatusBadge>;
}

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: "New",
  under_review: "Under review",
  planned: "Planned",
  in_progress: "In progress",
  shipped: "Shipped",
  closed: "Closed",
};

const FEEDBACK_STATUS_TONES: Record<FeedbackStatus, StatusTone> = {
  new: "info",
  under_review: "warning",
  planned: "accent",
  in_progress: "info",
  shipped: "success",
  closed: "neutral",
};

export function FeedbackStatusBadge({ status }: { status: FeedbackStatus }) {
  return (
    <StatusBadge tone={FEEDBACK_STATUS_TONES[status]}>{FEEDBACK_STATUS_LABELS[status]}</StatusBadge>
  );
}

export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  feature_request: "Feature request",
  bug: "Bug",
  improvement: "Improvement",
  question: "Question",
};

export function FeedbackCategoryBadge({ category }: { category: FeedbackCategory }) {
  const tone: StatusTone = category === "bug" ? "warning" : category === "feature_request" ? "accent" : "neutral";
  return <StatusBadge tone={tone}>{FEEDBACK_CATEGORY_LABELS[category]}</StatusBadge>;
}

export function NotConnectedBadge({ label = "Not connected" }: { label?: string }) {
  return <StatusBadge tone="warning">{label}</StatusBadge>;
}
