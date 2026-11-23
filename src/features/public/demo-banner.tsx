"use client";

import { useSyncExternalStore } from "react";

const subscribeToNothing = () => () => {};

/**
 * A label for visitors who arrived from `/demo`.
 *
 * There is no sample-data mode: the demo opens Herald's real public workspace
 * read-only. The banner makes that explicit and leaves a way back to the tour.
 * It reads the query string through a client snapshot so the server HTML is
 * unchanged and hydration does not mismatch.
 */
export function DemoBanner() {
  const visible = useSyncExternalStore(
    subscribeToNothing,
    () => new URLSearchParams(window.location.search).get("demo") === "1",
    () => false,
  );

  if (!visible) return null;

  return (
    <div
      role="note"
      className="border-b border-primary/25 bg-primary/10 px-4 py-2 text-center text-[12px] leading-relaxed text-foreground"
    >
      <strong className="font-semibold">Read-only demo.</strong> This is Herald&apos;s own public
      workspace; browsing does not change any workspace data.{" "}
      <a href="/demo" className="font-medium text-primary underline underline-offset-2">
        Back to the demo tour
      </a>
    </div>
  );
}
