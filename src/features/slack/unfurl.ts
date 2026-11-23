import "server-only";

import { getPublicRequestPage } from "@/features/public/queries";
import { getServerEnv } from "@/lib/env";
import { logEvent, serializeError } from "@/lib/logger";

import { unfurlSlackLinks, type SlackUnfurl } from "./client";
import { parseHeraldRequestUrl } from "./links";
import { statusLabel } from "./notify";

/**
 * Slack link unfurls for public Herald requests.
 *
 * The URL is resolved through the public projection, not the dashboard query:
 * a private, hidden, archived, merged or moderation-rejected request therefore
 * cannot be exposed by pasting its link into Slack. The origin must match the
 * canonical deployment origin, so a lookalike host is never queried.
 */

function escapeSlack(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function buildSlackUnfurl(link: string): Promise<SlackUnfurl | null> {
  const parsed = parseHeraldRequestUrl(link, getServerEnv().BETTER_AUTH_URL);
  if (!parsed) return null;

  const page = await getPublicRequestPage(parsed);
  if (!page) return null;

  const title = escapeSlack(page.request.title.slice(0, 160));
  const status = statusLabel(page.request.status);
  const canonical =
    `${getServerEnv().BETTER_AUTH_URL.replace(/\/+$/, "")}/p/` +
    `${encodeURIComponent(page.workspace.slug)}/${encodeURIComponent(page.product.slug)}/` +
    `${encodeURIComponent(page.board.slug)}/${encodeURIComponent(page.request.id)}`;

  return {
    text: `${page.request.title} — ${status}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*<${canonical}|${title}>*\n${status} · ${page.request.voteCount} vote${
            page.request.voteCount === 1 ? "" : "s"
          } · ${page.request.commentCount} comment${
            page.request.commentCount === 1 ? "" : "s"
          }`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `${escapeSlack(page.product.name)} on ${escapeSlack(page.workspace.name)} · ${escapeSlack(
              page.board.name,
            )}`,
          },
        ],
      },
    ],
  };
}

export async function unfurlHeraldRequestLinks(input: {
  token: string;
  channel: string;
  messageTs: string;
  links: string[];
}): Promise<number> {
  const unique = [...new Set(input.links)].slice(0, 10);
  if (unique.length === 0) return 0;

  const unfurls: Record<string, SlackUnfurl> = {};
  for (const link of unique) {
    try {
      const unfurl = await buildSlackUnfurl(link);
      if (unfurl) unfurls[link] = unfurl;
    } catch (error) {
      logEvent("warn", "slack.unfurl_build_failed", {
        error: serializeError(error),
      });
    }
  }
  if (Object.keys(unfurls).length === 0) return 0;

  await unfurlSlackLinks({
    token: input.token,
    channel: input.channel,
    messageTs: input.messageTs,
    unfurls,
  });
  return Object.keys(unfurls).length;
}
