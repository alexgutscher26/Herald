import type { MetadataRoute } from "next";

import { absolutePublicUrl, publicOrigin } from "@/features/public/urls";

/**
 * Crawler policy.
 *
 * The public feedback surface is indexable; the signed-in dashboard, API,
 * auth screens and token-bearing pages are not. Preferences and login links
 * carry credentials in the query string, so they are disallowed even though
 * their pages also emit `noindex`.
 */

// The origin comes from runtime configuration, so robots.txt is generated per
// request instead of being frozen with the build machine's environment.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/app",
          "/api/",
          "/sign-in",
          "/sign-up",
          "/p/*/login",
          "/p/*/preferences",
          "/p/*/search",
        ],
      },
    ],
    sitemap: absolutePublicUrl("/sitemap.xml"),
    host: publicOrigin(),
  };
}
