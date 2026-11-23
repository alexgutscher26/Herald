import { NextResponse } from "next/server";

import { getIssueConnectionForWebhook } from "@/features/integrations/issue-service";
import {
  parseIssueWebhook,
  verifyIssueWebhookSignature,
} from "@/features/integrations/issue-providers";
import { enqueueJob } from "@/features/jobs/queue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 256_000;

/**
 * One webhook receiver for all issue trackers.
 *
 * The unguessable connection token selects exactly one product. Signed
 * providers are checked over the raw body before parsing; Jira and Azure
 * DevOps do not sign admin webhooks, so the token is their authenticator.
 * Work is enqueued after the 200 so a provider retry cannot apply a status
 * twice (the job also has a unique delivery key).
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await context.params;
  const connection = await getIssueConnectionForWebhook(token);
  if (!connection) {
    return NextResponse.json({ error: "Unknown webhook." }, { status: 404 });
  }

  const contentLength = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  }
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  }

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  if (
    !verifyIssueWebhookSignature({
      provider: connection.provider,
      secret: connection.webhookSecret,
      rawBody,
      headers,
    })
  ) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const event = parseIssueWebhook(connection.provider, payload, headers);
  if (!event) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  await enqueueJob({
    type: "issue_tracker_event",
    dedupeKey: `issue-webhook:${connection.id}:${event.deliveryKey}`.slice(0, 1_000),
    payload: {
      connectionId: connection.id,
      provider: connection.provider,
      externalId: event.externalId,
      externalUrl: event.externalUrl,
      candidates: event.candidates,
      eventName: event.eventName,
      actorName: event.actorName,
      deliveryKey: event.deliveryKey,
    },
  });

  return NextResponse.json({ ok: true });
}
