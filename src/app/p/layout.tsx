import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * Public site shell.
 *
 * The dashboard's client providers and data selectors are deliberately absent:
 * a public page renders server-side from the public projections only, so it
 * cannot reach an internal note, a private board or a member's session.
 */

export const metadata: Metadata = {
  metadataBase: new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000"),
  robots: { index: true, follow: true },
};

export default function PublicLayout({ children }: { children: ReactNode }) {
  // The workspace layout owns the themed background: it sits below this shell
  // and its public-theme-* variables must paint the page, not the dashboard
  // palette from :root.
  return <div className="min-h-screen">{children}</div>;
}
