import type { SupportToolProvider } from "@/db/schema";

/**
 * Normalize the standard Intercom and Zendesk webhook payloads.
 *
 * No provider API call is made: the webhook is the capture event. The parser is
 * pure so a copied payload can be replayed in a unit test without a database.
 */

export type CapturedConversation = {
  externalId: string;
  title: string;
  body: string;
  authorName: string | null;
  authorEmail: string | null;
  occurredAt: Date | null;
};

const MAX_TITLE = 200;
const MAX_BODY = 20_000;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const candidate = text(value);
    if (candidate !== "") return candidate;
  }
  return "";
}

function htmlToText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function titleFromBody(body: string, fallback: string): string {
  const firstLine = body.split("\n")[0]?.replace(/\s+/g, " ").trim() ?? "";
  return (firstLine || fallback).slice(0, MAX_TITLE);
}

function occurredAt(value: unknown): Date | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value < 10_000_000_000 ? value * 1000 : value;
    const parsed = new Date(millis);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function zendesk(payload: Record<string, unknown>): CapturedConversation | null {
  const ticket = record(payload.ticket) ?? payload;
  const id = firstText(ticket.id, ticket.ticket_id);
  if (id === "") return null;

  const requester = record(ticket.requester) ?? {};
  const comments = Array.isArray(ticket.comments) ? ticket.comments : [];
  const commentBodies = comments
    .map((comment) => htmlToText(firstText(record(comment)?.body, record(comment)?.plain_body)))
    .filter((body) => body !== "");

  const description = htmlToText(
    firstText(ticket.description, ticket.plain_body, ticket.body),
  );
  const body = [description, ...commentBodies].filter(Boolean).join("\n\n").slice(0, MAX_BODY);
  if (body === "") return null;

  return {
    externalId: `zendesk:${id}`.slice(0, 300),
    title: titleFromBody(
      firstText(ticket.subject, ticket.title) || body,
      `Zendesk ticket ${id}`,
    ),
    body,
    authorName:
      firstText(requester.name, ticket.requester_name, ticket.author_name) || null,
    authorEmail:
      firstText(requester.email, ticket.requester_email, ticket.author_email) || null,
    occurredAt: occurredAt(firstText(ticket.created_at, ticket.updated_at)),
  };
}

function intercom(payload: Record<string, unknown>): CapturedConversation | null {
  const data = record(payload.data) ?? payload;
  const item = record(data.item) ?? record(data.conversation) ?? data;
  const id = firstText(item.id, item.conversation_id);
  if (id === "") return null;

  const source = record(item.source) ?? {};
  const author = record(source.author) ?? record(item.author) ?? {};
  const parts = record(item.conversation_parts)?.conversation_parts;
  const partBodies = Array.isArray(parts)
    ? parts
        .map((part) => htmlToText(firstText(record(part)?.body, record(part)?.plain_text)))
        .filter((body) => body !== "")
    : [];

  const opening = htmlToText(
    firstText(source.body, source.plain_text, item.body, item.description),
  );
  const body = [opening, ...partBodies].filter(Boolean).join("\n\n").slice(0, MAX_BODY);
  if (body === "") return null;

  return {
    externalId: `intercom:${id}`.slice(0, 300),
    title: titleFromBody(
      firstText(source.subject, item.subject, item.title) || body,
      `Intercom conversation ${id}`,
    ),
    body,
    authorName: firstText(author.name, author.email) || null,
    authorEmail: firstText(author.email) || null,
    occurredAt: occurredAt(firstText(item.created_at, source.created_at, item.updated_at)),
  };
}

export function parseSupportCapture(
  provider: SupportToolProvider,
  payload: unknown,
): CapturedConversation | null {
  const root = record(payload);
  if (!root) return null;
  return provider === "zendesk" ? zendesk(root) : intercom(root);
}
