"use client";

import { Play, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { toastActionFailure } from "@/components/shared/action-toast";

import { Button } from "@/components/ui/button";
import { deleteReportAction, runReportAction } from "./actions";

export function ReportCardActions({
  workspaceSlug,
  productSlug,
  reportId,
  canManage,
}: {
  workspaceSlug: string;
  productSlug: string;
  reportId: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const result = await runReportAction({ workspaceSlug, productSlug, reportId });
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      toast.success(
        result.data.alertTriggered
          ? "Report run. The threshold is currently crossed."
          : "Report run.",
      );
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteReportAction({ workspaceSlug, productSlug, reportId });
      if (!result.ok) {
        toastActionFailure(result);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-1">
      <Button type="button" size="sm" variant="outline" onClick={run} disabled={pending}>
        <Play aria-hidden="true" />
        Run
      </Button>
      {canManage ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Delete report"
          onClick={remove}
          disabled={pending}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}
