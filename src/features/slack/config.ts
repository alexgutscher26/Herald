import { z } from "zod";

import { getServerEnv } from "@/lib/env";

/**
 * Slack app configuration.
 *
 * All three secrets are required together: a partial configuration would let
 * an install start and then fail at the callback. An unset trio means the
 * integration is switched off rather than half-configured.
 */

const isUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const slackSchema = z.object({
  SLACK_CLIENT_ID: z.string().min(1, "SLACK_CLIENT_ID must not be empty"),
  SLACK_CLIENT_SECRET: z.string().min(1, "SLACK_CLIENT_SECRET must not be empty"),
  SLACK_SIGNING_SECRET: z
    .string()
    .min(16, "SLACK_SIGNING_SECRET must be at least 16 characters"),
  SLACK_REDIRECT_URI: z
    .string()
    .refine(isUrl, { message: "SLACK_REDIRECT_URI must be an absolute http(s) URL" }),
  SLACK_API_URL: z
    .string()
    .refine(isUrl, { message: "SLACK_API_URL must be an absolute http(s) URL" }),
  SLACK_AUTHORIZE_URL: z
    .string()
    .refine(isUrl, { message: "SLACK_AUTHORIZE_URL must be an absolute http(s) URL" }),
});

export type SlackConfig = z.infer<typeof slackSchema>;

export const SLACK_SCOPES = [
  "channels:history",
  "channels:read",
  "chat:write",
  "commands",
  "groups:history",
  "groups:read",
  "links:read",
  "links:write",
  "team:read",
].join(",");

export function getSlackConfig(): SlackConfig | null {
  const clientId = process.env.SLACK_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.SLACK_CLIENT_SECRET?.trim() ?? "";
  const signingSecret = process.env.SLACK_SIGNING_SECRET?.trim() ?? "";
  if (clientId === "" && clientSecret === "" && signingSecret === "") return null;

  const base = getServerEnv().BETTER_AUTH_URL.replace(/\/+$/, "");
  const redirectUri =
    process.env.SLACK_REDIRECT_URI?.trim() ||
    `${base}/api/integrations/slack/callback`;
  const apiUrl = process.env.SLACK_API_URL?.trim() || "https://slack.com/api";
  const authorizeUrl =
    process.env.SLACK_AUTHORIZE_URL?.trim() || "https://slack.com/oauth/v2/authorize";

  const result = slackSchema.safeParse({
    SLACK_CLIENT_ID: clientId,
    SLACK_CLIENT_SECRET: clientSecret,
    SLACK_SIGNING_SECRET: signingSecret,
    SLACK_REDIRECT_URI: redirectUri,
    SLACK_API_URL: apiUrl,
    SLACK_AUTHORIZE_URL: authorizeUrl,
  });
  if (!result.success) {
    throw new Error(
      `Invalid Slack configuration — ${result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}.`,
    );
  }
  return result.data;
}
