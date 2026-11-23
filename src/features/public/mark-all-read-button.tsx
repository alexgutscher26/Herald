"use client";

import { CheckCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { usePublicI18n } from "./i18n/provider";

export function MarkAllReadButton({
  workspaceSlug,
  productSlug,
  unread,
}: {
  workspaceSlug: string;
  productSlug: string;
  unread: number;
}) {
  const router = useRouter();
  const { t } = usePublicI18n();
  const [pending, setPending] = useState(false);

  async function markRead() {
    if (pending || unread === 0) return;
    setPending(true);

    try {
      const response = await fetch("/api/public/notifications/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceSlug, productSlug }),
      });
      if (!response.ok) {
        toast.error(t("notifications.markError"));
        return;
      }
      router.refresh();
    } catch {
      toast.error(t("notifications.markError"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => void markRead()}
      disabled={pending || unread === 0}
    >
      <CheckCheck aria-hidden="true" />
      {pending ? t("notifications.markingRead") : t("notifications.markAllRead")}
    </Button>
  );
}
