"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { getRequestBriefAction } from "./brief-actions";

/**
 * Copy the whole request as Markdown.
 *
 * The brief is built on demand rather than prefetched for every row: it reads
 * evidence, votes, comments and releases, and the detail panel is opened often
 * just to change a status.
 */
export function CopyBriefButton({
  workspaceSlug,
  productSlug,
  postId,
}: {
  workspaceSlug: string;
  productSlug: string;
  postId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function copy() {
    setBusy(true);
    try {
      const result = await getRequestBriefAction({ workspaceSlug, productSlug, postId });
      if (!result.ok) {
        toast.error("Could not build the brief", { description: result.error });
        return;
      }

      try {
        await navigator.clipboard.writeText(result.data.markdown);
      } catch {
        toast.error("Could not copy", {
          description:
            "Your browser blocked clipboard access. Fetch the brief from the API or MCP instead.",
        });
        return;
      }

      setCopied(true);
      toast.success("Brief copied", {
        description: "Problem, evidence, demand, status and open questions as Markdown.",
      });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not build the brief", {
        description: "The request may have been deleted. Reload and try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={copy}
      disabled={busy}
      className="shrink-0"
      title="Copy this request as a Markdown brief for an agent or a ticket"
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {busy ? "Building…" : copied ? "Copied" : "Copy brief"}
    </Button>
  );
}
