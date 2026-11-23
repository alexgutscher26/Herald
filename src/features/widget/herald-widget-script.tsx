"use client";

import { usePathname } from "next/navigation";

import type { HeraldWidgetInstall } from "./herald-widget-install";

/**
 * Herald's own installation snippet.
 *
 * `install` comes from the deployment's configuration and is `null` when no
 * workspace, product and public key are set together, in which case nothing is
 * rendered. The embed route is the widget itself; loading the public loader
 * there mounts a second launcher inside the panel, so it is skipped too.
 */
export function HeraldWidgetScript({
  install,
}: {
  install: HeraldWidgetInstall | null;
}) {
  const pathname = usePathname();
  if (!install) return null;

  const segments = pathname?.split("/") ?? [];
  if (segments.includes("embed") || segments.includes("preview")) return null;

  return (
    <script
      async
      id="herald-widget"
      src={install.src}
      data-project={install.project}
      data-key={install.publicKey}
    />
  );
}
