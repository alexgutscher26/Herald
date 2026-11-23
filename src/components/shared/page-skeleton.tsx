import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type PageSkeletonProps = {
  /**
   * Match the geometry of the page that is loading. `list` is the default for
   * table and inbox routes, `cards` for settings/dashboard grids, `form` for
   * editors.
   */
  variant?: "list" | "cards" | "form";
  className?: string;
};

/**
 * The single page-level loading pattern.
 *
 * The blocks mirror the page header, toolbar and content rows so the real
 * content replaces the skeleton without moving the page. It is deliberately
 * presentational: route-level `loading.tsx` files decide the variant, and the
 * shell keeps its own chrome.
 */
export function PageSkeleton({ variant = "list", className }: PageSkeletonProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn("w-full space-y-5", className)}
    >
      <span className="sr-only">Loading…</span>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>

      {variant === "list" ? <ListSkeleton /> : null}
      {variant === "cards" ? <CardsSkeleton /> : null}
      {variant === "form" ? <FormSkeleton /> : null}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-9 w-36" />
        <Skeleton className="h-9 w-36" />
        <Skeleton className="ml-auto h-4 w-28" />
      </div>
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="flex h-10 items-center gap-6 border-b bg-muted/30 px-4">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="ml-auto h-3.5 w-16" />
        </div>
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className="flex h-14 items-center gap-6 border-b px-4 last:border-b-0"
          >
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="hidden h-3.5 w-24 sm:block" />
            <Skeleton className="ml-auto h-3.5 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

function CardsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="space-y-3 rounded-lg border bg-card p-5">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3.5 w-4/5" />
          <Skeleton className="h-3.5 w-3/5" />
          <Skeleton className="mt-4 h-8 w-24" />
        </div>
      ))}
    </div>
  );
}

function FormSkeleton() {
  return (
    <div className="max-w-2xl space-y-6" aria-hidden="true">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="space-y-2">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-3 w-64 max-w-full" />
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-20" />
      </div>
    </div>
  );
}
