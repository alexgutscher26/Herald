import { NextResponse } from "next/server";

import { enqueueJob } from "@/features/jobs/queue";
import { getSlackConfig } from "@/features/slack/config";
import { getSlackIntegrationForEvent } from "@/features/slack/service";
import { verifySlackSignature } from "@/features/slack/sign";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 64_000;

/**
 * `/herald <text>` slash command.
 *
 * Slack requires a response within three seconds, so the request is queued and
 * the durable job replies through the command's one-shot response_url. The
 * command only works in a channel connected to a product, which keeps a Slack
 * team with several products unambiguous.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const config = getSlackConfig();
  if (!config) {
    return NextResponse.json({ error: "Slack is not configured." }, { status: 503 });
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

  const form = new URLSearchParams(rawBody);
  if (form.get("ssl_check") === "1") {
    return NextResponse.json({ ok: true });
  }

  const command = (form.get("command") ?? "").trim();
  if (command !== "/herald" && !command.startsWith("/herald@")) {
    return NextResponse.json({ response_type: "ephemeral", text: "Unknown command." });
  }

  const teamId = (form.get("team_id") ?? "").trim();
  const channelId = (form.get("channel_id") ?? "").trim();
  const userId = (form.get("user_id") ?? "").trim();
  const responseUrl = (form.get("response_url") ?? "").trim();
  const text = (form.get("text") ?? "").trim().slice(0, 20_000);
  const triggerId = (form.get("trigger_id") ?? "").trim();

  if (!teamId || !channelId || !userId || !responseUrl || !triggerId) {
    return NextResponse.json(
      { response_type: "ephemeral", text: "Slack sent an incomplete command request." },
      { status: 400 },
    );
  }
  if (text === "") {
    return NextResponse.json({
      response_type: "ephemeral",
      text: "Use `/herald <what the customer asked for>`.",
    });
  }

  const integration = await getSlackIntegrationForEvent({ teamId, channelId });
  if (!integration) {
    return NextResponse.json({
      response_type: "ephemeral",
      text: "This channel is not connected to a Herald product. Choose a notification channel under Product → Integrations.",
    });
  }

  try {
    await enqueueJob({
      type: "slack_command",
      payload: { teamId, channelId, userId, responseUrl, text },
      dedupeKey: `slack-command:${teamId}:${triggerId}`,
    });
  } catch {
    return NextResponse.json({
      response_type: "ephemeral",
      text: "Herald could not queue that request. Try again in a moment.",
    });
  }

  return NextResponse.json({
    response_type: "ephemeral",
    text: "Filing this as a feedback request…",
  });
}
