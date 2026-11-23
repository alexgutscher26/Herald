import "server-only";

import { getSlackConfig, type SlackConfig } from "./config";

/**
 * Minimal Slack Web API adapter.
 *
 * The base URL is configurable so the integration tests exercise the real
 * request/response shape against a local server; production uses slack.com.
 * Errors carry Slack's own error code so a job can distinguish a transient
 * rate limit from a channel that no longer exists.
 */

const REQUEST_TIMEOUT_MS = 10_000;

const NON_RETRYABLE_ERRORS = new Set([
  "channel_not_found",
  "invalid_auth",
  "missing_scope",
  "not_authed",
  "not_in_channel",
  "token_revoked",
  "user_not_found",
]);

export class SlackApiError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message?: string) {
    super(message ?? `Slack API error: ${code}.`);
    this.name = "SlackApiError";
    this.code = code;
    this.retryable = !NON_RETRYABLE_ERRORS.has(code);
  }
}

function apiBase(config: SlackConfig): string {
  return config.SLACK_API_URL.replace(/\/+$/, "");
}

async function slackRequest<T>(
  config: SlackConfig,
  path: string,
  init: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBase(config)}/${path.replace(/^\/+/, "")}`, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    throw new SlackApiError(
      "network_error",
      error instanceof Error ? error.message : "Could not reach Slack.",
    );
  }

  const payload = (await response.json().catch(() => null)) as
    | (T & { ok?: boolean; error?: string })
    | null;
  if (!response.ok || payload?.ok === false) {
    const code = payload?.error ?? `http_${response.status}`;
    throw new SlackApiError(code, `Slack rejected the request (${code}).`);
  }
  return payload as T;
}

export type SlackOAuthResult = {
  ok: true;
  access_token: string;
  bot_user_id?: string;
  scope?: string;
  team: { id: string; name: string };
};

export async function exchangeSlackCode(
  code: string,
  redirectUri: string,
): Promise<SlackOAuthResult> {
  const config = getSlackConfig();
  if (!config) throw new SlackApiError("not_configured", "Slack is not configured.");

  const body = new URLSearchParams({
    client_id: config.SLACK_CLIENT_ID,
    client_secret: config.SLACK_CLIENT_SECRET,
    code,
    redirect_uri: redirectUri,
  });
  return slackRequest<SlackOAuthResult>(config, "oauth.v2.access", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

export async function postSlackMessage(input: {
  token: string;
  channel: string;
  text: string;
  threadTs?: string | null;
}): Promise<{ ts: string }> {
  const config = getSlackConfig();
  if (!config) throw new SlackApiError("not_configured", "Slack is not configured.");

  const payload = await slackRequest<{ ok: true; ts: string }>(config, "chat.postMessage", {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.token}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: input.channel,
      text: input.text,
      ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
      unfurl_links: false,
    }),
  });
  return { ts: payload.ts };
}

export type SlackChannel = { id: string; name: string; isPrivate: boolean };

export async function listSlackChannels(token: string): Promise<SlackChannel[]> {
  const config = getSlackConfig();
  if (!config) throw new SlackApiError("not_configured", "Slack is not configured.");

  const channels: SlackChannel[] = [];
  let cursor = "";
  for (let page = 0; page < 5; page += 1) {
    const query = new URLSearchParams({
      types: "public_channel,private_channel",
      exclude_archived: "true",
      limit: "200",
      ...(cursor ? { cursor } : {}),
    });
    const payload = await slackRequest<{
      ok: true;
      channels: { id: string; name: string; is_private?: boolean }[];
      response_metadata?: { next_cursor?: string };
    }>(config, `conversations.list?${query.toString()}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    });
    for (const channel of payload.channels) {
      channels.push({
        id: channel.id,
        name: channel.name,
        isPrivate: channel.is_private === true,
      });
    }
    cursor = payload.response_metadata?.next_cursor ?? "";
    if (!cursor) break;
  }
  return channels;
}

export async function getSlackChannel(
  token: string,
  channelId: string,
): Promise<SlackChannel> {
  const config = getSlackConfig();
  if (!config) throw new SlackApiError("not_configured", "Slack is not configured.");

  const payload = await slackRequest<{
    ok: true;
    channel?: { id: string; name: string; is_private?: boolean };
  }>(config, "conversations.info", {
    method: "POST",
    // Slack's conversations.* methods read form-encoded parameters; a JSON
    // body arrives empty and the call fails with invalid_arguments.
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ channel: channelId }),
  });
  if (!payload.channel) throw new SlackApiError("channel_not_found");
  return {
    id: payload.channel.id,
    name: payload.channel.name,
    isPrivate: payload.channel.is_private === true,
  };
}

export async function getSlackUserName(token: string, userId: string): Promise<string> {
  const config = getSlackConfig();
  if (!config) throw new SlackApiError("not_configured", "Slack is not configured.");

  const payload = await slackRequest<{
    ok: true;
    user?: {
      name?: string;
      real_name?: string;
      profile?: { display_name?: string; real_name?: string };
    };
  }>(config, "users.info", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ user: userId }),
  });
  return (
    payload.user?.profile?.display_name?.trim() ||
    payload.user?.profile?.real_name?.trim() ||
    payload.user?.real_name?.trim() ||
    payload.user?.name?.trim() ||
    `Slack user ${userId}`
  );
}

export type SlackUnfurl = {
  text: string;
  blocks: unknown[];
};

/** Attach Herald preview cards to links already posted in Slack. */
export async function unfurlSlackLinks(input: {
  token: string;
  channel: string;
  messageTs: string;
  unfurls: Record<string, SlackUnfurl>;
}): Promise<void> {
  const config = getSlackConfig();
  if (!config) throw new SlackApiError("not_configured", "Slack is not configured.");

  await slackRequest<{ ok: true }>(config, "chat.unfurl", {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.token}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: input.channel,
      ts: input.messageTs,
      unfurls: input.unfurls,
    }),
  });
}

/** Reply to a slash command through Slack's one-shot response URL. */
export async function respondToSlackCommand(input: {
  responseUrl: string;
  text: string;
}): Promise<void> {
  let url: URL;
  try {
    url = new URL(input.responseUrl);
  } catch {
    throw new SlackApiError("invalid_response_url", "Slack returned an invalid response URL.");
  }
  if (
    url.protocol !== "https:" ||
    !(url.hostname === "hooks.slack.com" || url.hostname.endsWith(".slack.com"))
  ) {
    throw new SlackApiError("invalid_response_url", "Slack returned an unexpected response URL.");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ response_type: "ephemeral", text: input.text }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new SlackApiError(`http_${response.status}`, "Slack rejected the command response.");
  }
}
