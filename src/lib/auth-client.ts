"use client";

import { createAuthClient } from "better-auth/react";
import { ssoClient } from "@better-auth/sso/client";

/**
 * Browser-side auth client. It talks to the same origin as the page, so no
 * base URL (and therefore no secret) is ever baked into client bundles.
 */
export const authClient = createAuthClient({
  plugins: [ssoClient()],
});

export type AuthClient = typeof authClient;