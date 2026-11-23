import { NextResponse } from "next/server";

import { parseSupportCapture } from "@/features/support-tools/capture";
import {
  captureSupportConversation,
  getSupportConnectionForWebhook,
} from "@/features/support-tools/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 512_000;

/**
 * Inbound capture webhook for Intercom and Zendesk.
 *
 * The unguessable path token is the authenticator. Both providers can send
 * their standard webhook payload here without Herald asking for an OAuth grant;
 * only a request and its provenance are written, never the raw provider payload.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await context.params;
  if (!/^[A-Za-z0-9_-]{32,200}$/.test(token)) {
    return NextResponse.json({ error: "Unknown capture webhook." }, { status: 404 });
  }

  const contentLength = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  }

  const connection = await getSupportConnectionForWebhook(token);
  if (!connection) {
    return NextResponse.json({ error: "Unknown capture webhook." }, { status: 404 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const conversation = parseSupportCapture(connection.provider, payload);
  if (!conversation) {
    return NextResponse.json(
      {
        error:
          connection.provider === "zendesk"
            ? "Expected a ticket with an id and a subject or description."
            : "Expected an Intercom conversation with an id and a message body.",
      },
      { status: 400 },
    );
  }

  const captured = await captureSupportConversation({ connection, conversation });
  if (!captured.ok) {
    return NextResponse.json({ error: captured.error }, { status: 500 });
  }

  return NextResponse.json(
    {
      ok: true,
      request_id: captured.requestId,
      duplicate: captured.duplicate,
    },
    { status: captured.created ? 202 : 200 },
  );
}
