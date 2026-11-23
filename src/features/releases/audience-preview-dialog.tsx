"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { previewReleaseAudienceAction } from "./audience-actions";
import type { ReleaseAudiencePreview } from "./audience-types";
import { AudiencePreviewContent } from "./audience-preview-content";

/**
 * Load the audience only while it is visible.
 *
 * The linked-request list is serialized into a stable key so a re-render of
 * the editor cannot trigger a fresh request for the same audience.
 */
type AudienceRequest = {
  key: string;
  preview: ReleaseAudiencePreview | null;
  error: string | null;
};

export function useAudiencePreview(input: {
  enabled: boolean;
  workspaceSlug: string;
  productSlug: string;
  linkedFeedbackIds: string[];
  tagSlugs: string[];
  emailEnabled: boolean;
}) {
  const [request, setRequest] = useState<AudienceRequest | null>(null);
  const linkedKey = input.linkedFeedbackIds.join(",");
  const tagKey = input.tagSlugs.join(",");
  const requestKey = `${input.workspaceSlug}|${input.productSlug}|${input.emailEnabled}|${linkedKey}|${tagKey}`;

  useEffect(() => {
    if (!input.enabled) return;

    let cancelled = false;
    void previewReleaseAudienceAction({
      workspaceSlug: input.workspaceSlug,
      productSlug: input.productSlug,
      linkedFeedbackIds: linkedKey === "" ? [] : linkedKey.split(","),
      tagSlugs: tagKey === "" ? [] : tagKey.split(","),
      emailEnabled: input.emailEnabled,
    })
      .then((result) => {
        if (cancelled) return;
        setRequest(
          result.ok
            ? { key: requestKey, preview: result.data, error: null }
            : { key: requestKey, preview: null, error: result.error },
        );
      })
      .catch(() => {
        if (!cancelled) {
          setRequest({
            key: requestKey,
            preview: null,
            error: "Could not build the audience preview.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    input.enabled,
    input.workspaceSlug,
    input.productSlug,
    input.emailEnabled,
    linkedKey,
    tagKey,
    requestKey,
  ]);

  const current = input.enabled && request?.key === requestKey ? request : null;
  return {
    preview: current?.preview ?? null,
    error: current?.error ?? null,
    loading: input.enabled && request?.key !== requestKey,
  };
}

export function AudiencePreviewDialog({
  open,
  onOpenChange,
  workspaceSlug,
  productSlug,
  linkedFeedbackIds,
  tagSlugs,
  emailEnabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceSlug: string;
  productSlug: string;
  linkedFeedbackIds: string[];
  tagSlugs: string[];
  emailEnabled: boolean;
}) {
  const { preview, loading, error } = useAudiencePreview({
    enabled: open,
    workspaceSlug,
    productSlug,
    linkedFeedbackIds,
    tagSlugs,
    emailEnabled,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Subscriber email audience</DialogTitle>
          <DialogDescription>
            Who would receive this release, why they are on the list, and who is suppressed.
            Nothing is sent from this preview.
          </DialogDescription>
        </DialogHeader>

        <AudiencePreviewContent preview={preview} loading={loading} error={error} />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
