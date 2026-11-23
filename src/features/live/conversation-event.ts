/**
 * Conversation event contract.
 *
 * The same JSON travels from a Postgres trigger (or the typing route) through
 * the SSE endpoint to the dashboard client. Keep this module free of server
 * imports: the browser parses the payload with it.
 */

export const CONVERSATION_EVENT_CHANNEL = "herald_conversation_events";

export type ConversationEvent =
  | {
      type: "conversation";
      event: "insert" | "update" | "message" | "note" | "attachment";
      productId: string;
      conversationId: string;
      authorType?: string;
      at: number;
    }
  | {
      type: "typing";
      productId: string;
      conversationId: string;
      userId: string;
      name: string;
      at: number;
    }
  | {
      type: "presence";
      productId: string;
      userId: string;
      name: string;
      at: number;
    };

function text(value: unknown, max = 160): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max
    ? value
    : null;
}

function timestamp(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Date.now();
}

/**
 * Parse one wire payload. Unknown fields are discarded, and a malformed row is
 * ignored rather than allowed to break the stream for every listener.
 */
export function parseConversationEvent(value: unknown): ConversationEvent | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const productId = text(row.productId, 64);
  const at = timestamp(row.at);
  if (!productId) return null;

  if (row.type === "conversation") {
    const conversationId = text(row.conversationId, 64);
    const event = text(row.event, 20);
    if (
      !conversationId ||
      !["insert", "update", "message", "note", "attachment"].includes(event ?? "")
    ) {
      return null;
    }
    const authorType = text(row.authorType, 20);
    return {
      type: "conversation",
      event: event as "insert" | "update" | "message" | "note" | "attachment",
      productId,
      conversationId,
      ...(authorType ? { authorType } : {}),
      at,
    };
  }

  if (row.type === "typing") {
    const conversationId = text(row.conversationId, 64);
    const userId = text(row.userId, 120);
    const name = text(row.name, 120);
    if (!conversationId || !userId || !name) return null;
    return { type: "typing", productId, conversationId, userId, name, at };
  }

  if (row.type === "presence") {
    const userId = text(row.userId, 120);
    const name = text(row.name, 120);
    if (!userId || !name) return null;
    return { type: "presence", productId, userId, name, at };
  }

  return null;
}
