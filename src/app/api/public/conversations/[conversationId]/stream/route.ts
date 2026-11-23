import type { NextRequest } from "next/server";

import { loadCustomerThread } from "@/features/conversations/customer";
import { readCustomerSessionCookie } from "@/features/customer-session/http";
import { subscribeConversationEvents } from "@/features/live/conversation-events";

/**
 * Server-sent events for one customer thread.
 *
 * The stream is authorized by the same cookie + product + ownership check as
 * the JSON thread route. It only forwards events for this conversation, so a
 * customer can never observe another thread. The widget keeps its 3-second
 * poll as a fallback for proxies that buffer or drop the stream.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { conversationId: string };

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<Params> },
): Promise<Response> {
  const { conversationId } = await params;
  const url = new URL(request.url);
  const workspaceSlug = url.searchParams.get("workspaceSlug") ?? "";
  const productSlug = url.searchParams.get("productSlug") ?? "";
  if (!workspaceSlug || !productSlug) {
    return new Response("A workspace and product are required.", { status: 400 });
  }

  const authorized = await loadCustomerThread({
    workspaceSlug,
    productSlug,
    conversationId,
    sessionCookie: readCustomerSessionCookie(request),
  });
  if (authorized.state === "not_found") {
    return new Response("Not found.", { status: 404 });
  }
  if (authorized.state === "signed_out") {
    return new Response("Start a session first.", { status: 401 });
  }

  const encoder = new TextEncoder();
  let closed = false;
  let unsubscribe = () => {};
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        try {
          controller.close();
        } catch {
          // The client may already have closed the stream.
        }
      };

      request.signal.addEventListener("abort", cleanup, { once: true });

      send("retry: 3000\n\n");
      send(
        `event: ready\ndata: ${JSON.stringify({
          conversationId,
          at: Date.now(),
        })}\n\n`,
      );

      if (closed) return;
      unsubscribe = subscribeConversationEvents((event) => {
        if (event.type !== "conversation") return;
        if (event.conversationId !== conversationId) return;
        send(`event: conversation\ndata: ${JSON.stringify(event)}\n\n`);
      });

      heartbeat = setInterval(() => {
        send(": ping\n\n");
      }, 15_000);
    },
    cancel() {
      closed = true;
      unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "cache-control": "no-cache, no-transform",
      "content-type": "text/event-stream; charset=utf-8",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
