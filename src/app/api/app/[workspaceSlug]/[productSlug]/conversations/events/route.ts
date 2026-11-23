import { authorizeAppApi } from "@/features/app-api/auth";
import {
  publishConversationEvent,
  subscribeConversationEvents,
} from "@/features/live/conversation-events";
import { touchOperatorPresence } from "@/features/operators/service";

/**
 * Server-sent events for one product's inbox and thread.
 *
 * The endpoint is authorized with the same session and product checks as the
 * page. It sends a ready event immediately, then conversation events from the
 * Postgres feed plus a heartbeat. Presence is refreshed while the stream is
 * open, so an operator who leaves the tab stops appearing online after the
 * three-minute presence window.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceSlug: string; productSlug: string }> },
): Promise<Response> {
  const { workspaceSlug, productSlug } = await context.params;
  const authorized = await authorizeAppApi({
    request,
    workspaceSlug,
    productSlug,
    permission: "conversation:read",
  });
  if (!authorized.ok) return authorized.response;

  const { product, workspace, user } = authorized.context;
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
          productId: product.id,
          at: Date.now(),
        })}\n\n`,
      );

      // A closed enqueue during the ready frame must not add a listener after
      // cleanup has already run.
      if (closed) return;
      unsubscribe = subscribeConversationEvents((event) => {
        if (event.productId !== product.id) return;
        send(`event: conversation\ndata: ${JSON.stringify(event)}\n\n`);
      });

      const presence = () => {
        void touchOperatorPresence({
          workspaceId: workspace.id,
          userId: user.id,
        })
          .then((ok) => {
            if (!ok || closed) return;
            return publishConversationEvent({
              type: "presence",
              productId: product.id,
              userId: user.id,
              name: user.name,
              at: Date.now(),
            });
          })
          .catch((error) => {
            console.error(
              "[conversation-events] presence heartbeat failed",
              error instanceof Error ? error.message : error,
            );
          });
      };

      presence();
      let ticks = 0;
      heartbeat = setInterval(() => {
        if (closed) return;
        send(": ping\n\n");
        ticks += 1;
        // A browser tab counts as present while it holds the stream. Refresh
        // the database heartbeat once a minute, well inside the 3-minute TTL.
        if (ticks % 4 === 0) presence();
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
      // A stream needs no-cache rather than the JSON route's no-store.
      "cache-control": "no-cache, no-transform",
      "content-type": "text/event-stream; charset=utf-8",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
