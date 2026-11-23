import { withPostHogConfig } from "@posthog/nextjs-config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The e2e suite builds into its own directory: a developer's `next dev`
  // rewrites `.next` on every request, which would break `next start` while a
  // Playwright run is in progress.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // `pg` resolves optional native drivers at runtime; keep it out of the bundle.
  serverExternalPackages: ["pg"],
  // A tunnel or any non-localhost origin (a Cloudflare quick tunnel, a phone on
  // the LAN) is a different origin to the dev server, which answers its own
  // `/_next/*` requests with 403 unless it is listed here — the page renders
  // but never hydrates, so forms fall back to a native submit.
  allowedDevOrigins: ["*.trycloudflare.com", "*.ngrok-free.app", "*.ngrok.io", "*.loca.lt"],
  // Keep local previews clean; the build indicator is a development-only
  // overlay that otherwise floats over the widget we are inspecting.
  devIndicators: false,
  experimental: {
    // Server source maps are generated for error tracking. They are not served
    // to browsers (productionBrowserSourceMaps stays off); configured release
    // uploaders send the maps to their error-tracking collectors.
    serverSourceMaps: true,
    serverActions: {
      // Covers are uploaded to the storage module through their own route, so
      // they no longer need an inflated action body. File imports that still
      // travel through an action (Juno documents, API doc specs) declare their
      // own ceilings up to 10 MB; the transport limit matches those, not a
      // base64 image.
      bodySizeLimit: "10mb",
    },
    // Record that this project tracks security-only upgrade guidance from
    // `next upgrade --agent=security`.
    agentUpgrade: "security",
  },
  async rewrites() {
    // OAuth/MCP discovery lives at the origin root. Route handlers are mounted
    // under /api/well-known so Next never has to treat a dot-folder as a route.
    return [
      {
        source: "/.well-known/oauth-protected-resource",
        destination: "/api/well-known/oauth-protected-resource",
      },
      {
        source: "/.well-known/oauth-protected-resource/:path*",
        destination: "/api/well-known/oauth-protected-resource",
      },
      {
        source: "/.well-known/oauth-authorization-server",
        destination: "/api/well-known/oauth-authorization-server",
      },
      {
        source: "/.well-known/oauth-authorization-server/:path*",
        destination: "/api/well-known/oauth-authorization-server",
      },
    ];
  },
  async headers() {
    return [
      {
        // A versioned loader is immutable; a new cache key means a new URL, so
        // host pages never receive a cached half-upgraded launcher.
        source: "/widget/v1.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        source: "/widget/v1.css",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

const postHogSourceMapUploadEnabled = Boolean(
  process.env.POSTHOG_PERSONAL_API_KEY && process.env.POSTHOG_PROJECT_ID,
);

// `bun run build:sourcemaps` uploads the same `.next/server` maps after the
// build, so they are only removed when that upload cannot run.
const sentrySourceMapUploadConfigured = Boolean(
  process.env.SENTRY_ORG && process.env.SENTRY_PROJECT && process.env.SENTRY_AUTH_TOKEN,
);

export default withPostHogConfig(nextConfig, {
  personalApiKey: process.env.POSTHOG_PERSONAL_API_KEY ?? "",
  projectId: process.env.POSTHOG_PROJECT_ID,
  sourcemaps: {
    enabled: postHogSourceMapUploadEnabled,
    // Named explicitly so the upload never falls back to reading git: builds
    // from a tarball, a container or a damaged checkout would otherwise fail
    // on `release resolve`. The version matches `getReleaseInfo()`, which tags
    // the errors themselves.
    releaseName: "herald",
    releaseVersion:
      process.env.RELEASE_VERSION ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
    deleteAfterUpload: !sentrySourceMapUploadConfigured,
  },
});
