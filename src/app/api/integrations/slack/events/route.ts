import { NextResponse } from "next/server";

import { enqueueJob } from "@/features/jobs/queue";
import { getSlackConfig } from "@/features/slack/config";
import { getSlackIntegrationForEvent } from "@/features/slack/service";
import { verifySlackSignature } from "@/features/slack/sign";
import { findSlackSupportLink, parseSupportCommand } from "@/features/slack/support";
import { unfurlHeraldRequestLinks } from "@/features/slack/unfurl";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 256_000;

/**
 * Slack Events API endpoint.
 *
 * Slack retries a failed delivery, so the event id is the job's dedupe key and
 * all work happens after the 200. The signature is checked over the raw body
 * before parsing, and an unknown team/channel is ignored rather than creating a
 * request in the wrong product.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const config = getSlackConfig();
  if (!config) {
    return NextResponse.json({ error: "Slack is not configured." }, { status: 503 });
  }

  const contentLength = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  }

  const valid = verifySlackSignature({
    signingSecret: config.SLACK_SIGNING_SECRET,
    timestamp: request.headers.get("x-slack-request-timestamp"),
    signature: request.headers.get("x-slack-signature"),
    body: rawBody,
  });
  if (!valid) {
    return NextResponse.json({ error: "Invalid Slack signature." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (typeof payload !== "object" || payload === null) {
    return NextResponse.json({ error: "Invalid event." }, { status: 400 });
  }

  const envelope = payload as {
    type?: unknown;
    challenge?: unknown;
    team_id?: unknown;
    event_id?: unknown;
    event?: {
      type?: unknown;
      subtype?: unknown;
      channel?: unknown;
      text?: unknown;
      ts?: unknown;
      message_ts?: unknown;
      thread_ts?: unknown;
      user?: unknown;
      bot_id?: unknown;
      links?: unknown;
    };
  };

  if (envelope.type === "url_verification") {
    if (typeof envelope.challenge !== "string") {
      return NextResponse.json({ error: "Missing challenge." }, { status: 400 });
    }
    return NextResponse.json({ challenge: envelope.challenge });
  }

  if (envelope.type !== "event_callback") {
    return NextResponse.json({ ok: true, ignored: "not_event_callback" });
  }

  const teamId = typeof envelope.team_id === "string" ? envelope.team_id : "";
  const eventId = typeof envelope.event_id === "string" ? envelope.event_id : "";
  const event = envelope.event;
  if (!teamId || !eventId || !event) {
    return NextResponse.json({ ok: true, ignored: "missing_event" });
  }

  if (event.type === "link_shared") {
    if (
      typeof event.channel !== "string" ||
      typeof event.message_ts !== "string" ||
      !Array.isArray(event.links)
    ) {
      return NextResponse.json({ ok: true, ignored: "unsupported_link_shared" });
    }
    const integration = await getSlackIntegrationForEvent({
      teamId,
      channelId: event.channel,
    });
    if (!integration) {
      return NextResponse.json({ ok: true, ignored: "channel_not_connected" });
    }
    const links = event.links
      .map((link) =>
        typeof link === "object" && link !== null && "url" in link
          ? (link as { url?: unknown }).url
          : null,
      )
      .filter((url): url is string => typeof url === "string" && url.length <= 2_000);
    await unfurlHeraldRequestLinks({
      token: integration.accessToken,
      channel: event.channel,
      messageTs: event.message_ts,
      links,
    }).catch(() => undefined);
    return NextResponse.json({ ok: true });
  }

  if (event.type !== "message") {
    return NextResponse.json({ ok: true, ignored: "not_message" });
  }
  if (
    event.bot_id ||
    typeof event.subtype === "string" ||
    typeof event.channel !== "string" ||
    typeof event.text !== "string" ||
    typeof event.ts !== "string" ||
    event.text.trim() === ""
  ) {
    return NextResponse.json({ ok: true, ignored: "unsupported_message" });
  }
  const integration = await getSlackIntegrationForEvent({
    teamId,
    channelId: event.channel,
  });
  if (!integration) {
    return NextResponse.json({ ok: true, ignored: "channel_not_connected" });
  }

  const userId = typeof event.user === "string" ? event.user : "";
  const threadTs =
    typeof event.thread_ts === "string" && event.thread_ts !== event.ts
      ? event.thread_ts
      : null;

  if (threadTs) {
    // Only a reply in a mapped support thread continues a conversation;
    // feedback threads remain chatter and are covered by status updates.
    const link = await findSlackSupportLink({
      teamId,
      channelId: event.channel,
      threadTs,
    });
    if (!link) return NextResponse.json({ ok: true, ignored: "thread_reply" });

    await enqueueJob({
      type: "slack_support_message",
      dedupeKey: `slack-support-reply:${teamId}:${eventId}`,
      payload: {
        eventId,
        teamId,
        channelId: event.channel,
        messageTs: event.ts,
        threadTs,
        text: event.text.slice(0, 20_000),
        userId,
        isThreadReply: true,
      },
    });
    return NextResponse.json({ ok: true });
  }

  const support = parseSupportCommand(event.text);
  if (support) {
    await enqueueJob({
      type: "slack_support_message",
      dedupeKey: `slack-support-start:${teamId}:${eventId}`,
      payload: {
        eventId,
        teamId,
        channelId: event.channel,
        messageTs: event.ts,
        threadTs: event.ts,
        text: support.body,
        userId,
        isThreadReply: false,
      },
    });
    return NextResponse.json({ ok: true });
  }

  await enqueueJob({
    type: "slack_message",
    dedupeKey: `slack-event:${teamId}:${eventId}`,
    payload: {
      eventId,
      teamId,
      channelId: event.channel,
      messageTs: event.ts,
      text: event.text.slice(0, 20_000),
      userId,
    },
  });

  return NextResponse.json({ ok: true });
}
