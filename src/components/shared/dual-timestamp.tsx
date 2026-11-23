"use client";

import { useSyncExternalStore } from "react";

import { formatDate, formatDateTime } from "@/lib/format";

/**
 * The viewer's IANA zone is only knowable in the browser. The first client
 * render deliberately matches the server (no viewer zone), then the client
 * snapshot appends it, so server markup and hydration stay identical.
 */
const subscribeToNothing = () => () => {};

function readViewerTimeZone(): string | null {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function readServerTimeZone(): string | null {
  return null;
}

function useViewerTimeZone(): string | null {
  // `useSyncExternalStore` supplies the server value for the hydration render
  // and the browser value immediately after, without an effect-driven state
  // update (which the lint rules reject and which would cascade renders).
  return useSyncExternalStore(
    subscribeToNothing,
    readViewerTimeZone,
    readServerTimeZone,
  );
}

/** A labelled statement of the viewer's own zone, for page headers. */
export function ViewerTimeZone({ timeZone }: { timeZone: string }) {
  const viewer = useViewerTimeZone();

  if (!viewer) return null;
  return (
    <span>
      {viewer === timeZone
        ? `Your time zone: ${viewer} (same as the workspace)`
        : `Your time zone: ${viewer}`}
    </span>
  );
}

/**
 * One instant, shown in the workspace's zone and in the viewer's zone.
 *
 * Use this instead of a bare timestamp: the workspace zone is always labelled,
 * and the viewer's local time is added once it can be resolved in the browser.
 */
export function DualTimestamp({
  iso,
  timeZone,
  dateOnly = false,
  className,
}: {
  iso: string | null | undefined;
  timeZone: string;
  dateOnly?: boolean;
  className?: string;
}) {
  const viewer = useViewerTimeZone();

  if (!iso) return <span className={className}>—</span>;

  const workspaceLabel = dateOnly ? formatDate(iso, timeZone) : formatDateTime(iso, timeZone);

  if (!viewer) {
    return (
      <span className={className} title={`Workspace time (${timeZone})`}>
        {workspaceLabel}
      </span>
    );
  }

  const viewerLabel = dateOnly ? formatDate(iso, viewer) : formatDateTime(iso, viewer);

  if (viewer === timeZone) {
    return (
      <span className={className} title={`Workspace and your time zone: ${timeZone}`}>
        {workspaceLabel}{" "}
        <span className="text-muted-foreground">({timeZone}, workspace and your time)</span>
      </span>
    );
  }

  return (
    <span className={className}>
      <span title={`Workspace time (${timeZone})`}>
        {workspaceLabel} <span className="text-muted-foreground">(workspace)</span>
      </span>
      <span className="text-muted-foreground">
        {" "}
        · {viewerLabel} (your time)
      </span>
    </span>
  );
}
