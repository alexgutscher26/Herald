import { ArrowRight, Clock3 } from "lucide-react";
import Link from "next/link";

import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";

/**
 * Shown for a section that is linked externally but not built yet.
 *
 * The page deliberately renders no records: showing placeholder rows here
 * would make an unbuilt feature look like real product data. The route stays
 * addressable so a bookmark or an old email link explains itself.
 */
export function SectionUnavailable({
  title,
  description,
  workspaceSlug,
  productSlug,
}: {
  title: string;
  description: string;
  workspaceSlug: string;
  productSlug: string;
}) {
  const base = `/app/${workspaceSlug}/${productSlug}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="[font-family:var(--font-archivo)] text-[26px] font-semibold leading-tight tracking-[-0.02em]">{title}</h1>
            <StatusBadge tone="info">Coming later</StatusBadge>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
        </div>
      </div>

      <div className="rounded-[10px] border bg-card p-5 shadow-[0_1px_2px_rgba(23,22,20,0.04)]">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-info-muted text-info">
            <Clock3 className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 space-y-3">
            <div>
              <h2 className="text-sm font-semibold">This section is coming later</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                This page is linked for reference but is not available yet. It reads and writes no
                workspace data, and nothing here is shown in the primary navigation. The rest of the
                dashboard is fully functional.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <Link href={`${base}/releases`}>
                  Open releases
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href={`${base}/feedback`}>
                  Open feedback
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
