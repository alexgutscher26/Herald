"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { parseConversationEvent } from "@/features/live/conversation-event";

export type OnlineOperator = { id: string; name: string };

type TypingOperator = { id: string; name: string; expiresAt: number };
type PresenceOperator = OnlineOperator & { lastSeenAt: number };

const TYPING_TTL_MS = 4_000;
const PRESENCE_TTL_MS = 3 * 60 * 1000;

/**
 * Conversation live updates.
 *
 * One SSE connection per open inbox/thread replaces the 5-second poll. A
 * conversation event refreshes the server component; typing and presence stay
 * local so a keystroke never causes a round trip through React. If the stream
 * cannot open (older proxy, signed-out session, unsupported browser), the
 * component falls back to the previous visibility-guarded refresh instead of
 * leaving the inbox stale.
 */
export function ConversationLive({
  workspaceSlug,
  productSlug,
  conversationId,
  currentUserId,
  initialOnline = [],
  showPresence = false,
}: {
  workspaceSlug: string;
  productSlug: string;
  conversationId?: string;
  currentUserId: string;
  initialOnline?: OnlineOperator[];
  showPresence?: boolean;
}) {
  const router = useRouter();
  const [typing, setTyping] = useState<TypingOperator[]>([]);
  const [online, setOnline] = useState<PresenceOperator[]>(() =>
    initialOnline.map((operator) => ({
      ...operator,
      lastSeenAt: Date.now(),
    })),
  );

  useEffect(() => {
    const url = `/api/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
      productSlug,
    )}/conversations/events`;

    let source: EventSource | null = null;
    let closed = false;
    let refreshTimer: number | null = null;
    let fallbackTimer: number | null = null;
    let fallbackDelay: number | null = null;
    let reconnectTimer: number | null = null;

    const canRefresh = () => {
      if (document.visibilityState !== "visible") return false;
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        active.closest("input, textarea, select, [contenteditable='true']")
      ) {
        return false;
      }
      return true;
    };

    const refresh = () => {
      if (!closed && canRefresh()) router.refresh();
    };

    const scheduleRefresh = () => {
      if (refreshTimer !== null) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        refresh();
      }, 250);
    };

    const startFallback = () => {
      if (closed || fallbackTimer !== null) return;
      fallbackTimer = window.setInterval(() => {
        if (document.visibilityState === "visible") router.refresh();
      }, 5_000);
    };

    const stopFallback = () => {
      if (fallbackTimer !== null) {
        window.clearInterval(fallbackTimer);
        fallbackTimer = null;
      }
      if (fallbackDelay !== null) {
        window.clearTimeout(fallbackDelay);
        fallbackDelay = null;
      }
    };

    const connect = () => {
      if (closed) return;
      source?.close();
      source = new EventSource(url);

      source.addEventListener("ready", () => {
        stopFallback();
      });

      source.addEventListener("conversation", (raw) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse((raw as MessageEvent<string>).data);
        } catch {
          return;
        }
        const event = parseConversationEvent(parsed);
        if (!event) return;

        if (event.type === "conversation") {
          scheduleRefresh();
          return;
        }

        if (event.type === "typing") {
          if (
            !conversationId ||
            event.conversationId !== conversationId ||
            event.userId === currentUserId
          ) {
            return;
          }
          setTyping((current) => [
            ...current.filter((entry) => entry.id !== event.userId),
            {
              id: event.userId,
              name: event.name,
              expiresAt: Date.now() + TYPING_TTL_MS,
            },
          ]);
          return;
        }

        if (event.type === "presence" && event.userId !== currentUserId) {
          setOnline((current) => [
            ...current.filter((entry) => entry.id !== event.userId),
            {
              id: event.userId,
              name: event.name,
              lastSeenAt: Date.now(),
            },
          ]);
        }
      });

      source.onerror = () => {
        // EventSource reconnects on its own. Give it ten seconds, then fall
        // back to the previous polling cadence; a closed stream is recreated.
        if (fallbackDelay === null) {
          fallbackDelay = window.setTimeout(startFallback, 10_000);
        }
        if (source?.readyState === EventSource.CLOSED && reconnectTimer === null) {
          startFallback();
          reconnectTimer = window.setTimeout(() => {
            reconnectTimer = null;
            connect();
          }, 5_000);
        }
      };
    };

    connect();

    const expiry = window.setInterval(() => {
      const now = Date.now();
      setTyping((current) =>
        current.some((entry) => entry.expiresAt <= now)
          ? current.filter((entry) => entry.expiresAt > now)
          : current,
      );
      setOnline((current) =>
        current.some((entry) => now - entry.lastSeenAt >= PRESENCE_TTL_MS)
          ? current.filter((entry) => now - entry.lastSeenAt < PRESENCE_TTL_MS)
          : current,
      );
    }, 1_000);

    return () => {
      closed = true;
      source?.close();
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      stopFallback();
      window.clearInterval(expiry);
    };
  }, [conversationId, currentUserId, productSlug, router, workspaceSlug]);

  const typists = typing.filter((entry) => entry.id !== currentUserId);
  const onlineOthers = online.filter((entry) => entry.id !== currentUserId);

  if (typists.length === 0 && (!showPresence || onlineOthers.length === 0)) {
    return null;
  }

  return (
    <p className="min-h-5 text-xs text-muted-foreground" aria-live="polite">
      {typists.length > 0 ? (
        `${typists.map((entry) => entry.name).join(", ")} ${
          typists.length === 1 ? "is" : "are"
        } typing…`
      ) : (
        <>
          <span
            className="mr-1.5 inline-block size-1.5 rounded-full bg-success align-middle"
            aria-hidden="true"
          />
          {onlineOthers.length} teammate{onlineOthers.length === 1 ? "" : "s"} online
        </>
      )}
    </p>
  );
}
