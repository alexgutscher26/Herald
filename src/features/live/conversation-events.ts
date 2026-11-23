import "server-only";

import { sql } from "drizzle-orm";
import { Client } from "pg";

import { db } from "@/db";
import { getDatabaseUrl } from "@/lib/env";

import {
  CONVERSATION_EVENT_CHANNEL,
  parseConversationEvent,
  type ConversationEvent,
} from "./conversation-event";

/**
 * Server-side conversation event fan-out.
 *
 * Postgres triggers publish conversation/message/attachment changes on
 * `herald_conversation_events`; this module holds one LISTEN connection per
 * process and fans notifications out to every open SSE response. Typing and
 * presence events use the same publisher.
 *
 * The listener is lazy and best-effort. If LISTEN is unavailable (for example
 * a transaction-pooled database endpoint), the SSE route still serves ready
 * events and the browser falls back to its 5-second refresh. Nothing here runs
 * during a build.
 */

type Listener = (event: ConversationEvent) => void;

const listeners = new Set<Listener>();
let client: Client | null = null;
let connecting = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryMs = 1_000;
/** Invalidates an in-flight connect after the last subscriber leaves. */
let generation = 0;

function emitLocal(event: ConversationEvent): void {
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch (error) {
      console.error("[conversation-events] listener failed", error);
    }
  }
}

function scheduleRetry(): void {
  if (listeners.size === 0 || retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void ensureListener();
  }, retryMs);
  retryTimer.unref?.();
  retryMs = Math.min(retryMs * 2, 30_000);
}

function dropClient(candidate: Client): void {
  if (client !== candidate) return;
  client = null;
  connecting = false;
  candidate.end().catch(() => {});
  scheduleRetry();
}

async function ensureListener(): Promise<void> {
  if (client || connecting || listeners.size === 0) return;
  connecting = true;
  const attempt = generation;

  let connectionString: string;
  try {
    connectionString = getDatabaseUrl();
  } catch (error) {
    connecting = false;
    console.error(
      "[conversation-events] database is not configured; live updates fall back to polling",
      error instanceof Error ? error.message : error,
    );
    return;
  }

  const candidate = new Client({
    connectionString,
    application_name: "herald-conversation-events",
    connectionTimeoutMillis: 5_000,
  });
  client = candidate;

  candidate.on("notification", (message) => {
    if (message.channel !== CONVERSATION_EVENT_CHANNEL || !message.payload) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(message.payload);
    } catch {
      return;
    }
    const event = parseConversationEvent(parsed);
    if (event) emitLocal(event);
  });
  candidate.on("error", (error) => {
    console.error("[conversation-events] listener error", error.message);
    dropClient(candidate);
  });
  candidate.on("end", () => dropClient(candidate));

  try {
    await candidate.connect();
    await candidate.query(`LISTEN ${CONVERSATION_EVENT_CHANNEL}`);
    // The last subscriber may have left while the connection was opening.
    // Close this candidate instead of leaving an untracked LISTEN client.
    if (attempt !== generation || listeners.size === 0) {
      if (client === candidate) client = null;
      connecting = false;
      await candidate.end().catch(() => {});
      return;
    }
    connecting = false;
    retryMs = 1_000;
  } catch (error) {
    connecting = false;
    console.error(
      "[conversation-events] LISTEN failed; live updates fall back to polling",
      error instanceof Error ? error.message : error,
    );
    if (attempt !== generation || client !== candidate) {
      if (client === candidate) client = null;
      connecting = false;
      await candidate.end().catch(() => {});
    } else {
      connecting = false;
      dropClient(candidate);
    }
  }
}

/**
 * Subscribe to product-scoped events. The caller must unsubscribe on abort.
 */
export function subscribeConversationEvents(listener: Listener): () => void {
  listeners.add(listener);
  void ensureListener();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      generation += 1;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      const active = client;
      client = null;
      connecting = false;
      active?.end().catch(() => {});
    }
  };
}

/**
 * Publish to local listeners immediately and to other instances through
 * Postgres. A notification failure must not fail the caller's write.
 */
export async function publishConversationEvent(
  event: ConversationEvent,
): Promise<void> {
  emitLocal(event);
  try {
    await db.execute(
      sql`select pg_notify(${CONVERSATION_EVENT_CHANNEL}, ${JSON.stringify(event)})`,
    );
  } catch (error) {
    console.error(
      "[conversation-events] publish failed",
      error instanceof Error ? error.message : error,
    );
  }
}
