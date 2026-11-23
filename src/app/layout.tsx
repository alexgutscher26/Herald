import type { Metadata, Viewport } from "next";

import { publicOrigin } from "@/features/public/urls";
import { getHeraldWidgetInstall } from "@/features/widget/herald-widget-install";
import { HeraldWidgetScript } from "@/features/widget/herald-widget-script";
import { archivo, inter } from "@/lib/fonts";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

import "./globals.css";

export const metadata: Metadata = {
  // Relative canonicals and Open Graph URLs in any route resolve against the
  // deployment origin instead of the request host.
  metadataBase: new URL(publicOrigin()),
  title: {
    default: "Herald — Changelog & customer loops",
    template: "%s · Herald",
  },
  description:
    "Changelog publishing, feedback, public roadmaps, a What's New widget and win-back campaigns for small SaaS teams.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/icon-192.png",
  },
  appleWebApp: { capable: true, title: "Herald", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#1f6b45",
};

// Inline so the root layout does not add a client chunk to every dashboard
// route. The worker itself ignores app and API paths.
const SERVICE_WORKER_SCRIPT = `
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () {});
  }, { once: true });
}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The inline theme script adds or removes `dark` on <html> before React
    // hydrates. That class is intentionally client-owned, so the element must
    // not be treated as a hydration mismatch.
    <html
      lang="en"
      className={`${archivo.variable} ${inter.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {process.env.NODE_ENV === "production" ? (
          <script dangerouslySetInnerHTML={{ __html: SERVICE_WORKER_SCRIPT }} />
        ) : null}
      </head>
      <body className="font-sans">
        {children}
        <HeraldWidgetScript install={getHeraldWidgetInstall()} />
      </body>
    </html>
  );
}
