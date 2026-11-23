import { WEBHOOK_EVENTS, type WebhookEvent } from "@/db/schema";

/**
 * Public webhook event catalogue.
 *
 * Examples are the same shape the emitters send. Keeping them next to the
 * event list means the dashboard, the test event and the documentation cannot
 * drift into three different payloads.
 */

export type WebhookEventDefinition = {
  event: WebhookEvent;
  label: string;
  description: string;
  example: Record<string, unknown>;
};

const REQUEST_ID = "5f0c8f9a-6a2e-4f0e-9d4a-1c2b3a4d5e6f";
const BOARD_ID = "2b3c4d5e-6f70-4819-8a2b-3c4d5e6f7081";
const COMMENT_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const RELEASE_ID = "7d6c5b4a-3928-4170-8a6b-5c4d3e2f1a09";
const CONVERSATION_ID = "1a2b3c4d-5e6f-4708-9a0b-1c2d3e4f5061";
const MESSAGE_ID = "6f5e4d3c-2b1a-4098-8776-655443322110";
const CUSTOMER_ID = "0f1e2d3c-4b5a-4968-8776-655443322110";

export const WEBHOOK_EVENT_CATALOG: readonly WebhookEventDefinition[] = [
  {
    event: "request.created",
    label: "Request created",
    description:
      "A feedback request was created by the dashboard, API, public board, Slack or a capture integration.",
    example: {
      request_id: REQUEST_ID,
      board_id: BOARD_ID,
      title: "Export requests as CSV",
      status: "open",
      visibility: "published",
      source: "slack",
    },
  },
  {
    event: "request.updated",
    label: "Request updated",
    description:
      "A request changed, including status changes pushed from an issue tracker. `changed` lists the fields supplied to the update.",
    example: {
      request_id: REQUEST_ID,
      changed: ["status", "impact"],
      from_status: "open",
      to_status: "planned",
      source: "linear",
      external_issue_id: "lin_issue_123",
    },
  },
  {
    event: "comment.created",
    label: "Comment created",
    description:
      "A comment was added to a request. Internal notes are included but marked with `internal: true`.",
    example: {
      request_id: REQUEST_ID,
      comment_id: COMMENT_ID,
      internal: false,
    },
  },
  {
    event: "changelog.created",
    label: "Changelog entry created",
    description:
      "A changelog draft was created through the API. Publishing a release uses the normal release jobs, not a separate webhook event.",
    example: {
      release_id: RELEASE_ID,
      status: "draft",
    },
  },
  {
    event: "conversation.updated",
    label: "Conversation updated",
    description:
      "A support conversation changed status or assignee through the API.",
    example: {
      conversation_id: CONVERSATION_ID,
      status: "open",
      assignee_id: null,
    },
  },
  {
    event: "message.created",
    label: "Support message created",
    description:
      "A team reply or internal note was added to a support conversation through the API.",
    example: {
      conversation_id: CONVERSATION_ID,
      message_id: MESSAGE_ID,
      kind: "message",
    },
  },
  {
    event: "customer.event",
    label: "Customer event",
    description:
      "A product event was recorded for a customer. Properties are the event's own JSON object.",
    example: {
      event_id: "evt_01J8Z9WXYZ0123456789ABCDEF",
      name: "signed_up",
      customer_id: CUSTOMER_ID,
      external_id: "cus_123",
      occurred_at: "2026-11-21T09:30:00.000Z",
      properties: { plan: "pro", source: "website" },
    },
  },
];

const BY_EVENT = new Map(
  WEBHOOK_EVENT_CATALOG.map((definition) => [definition.event, definition]),
);

assertWebhookCatalogueComplete();

export function webhookEventDefinition(
  event: WebhookEvent,
): WebhookEventDefinition {
  const definition = BY_EVENT.get(event);
  if (!definition) throw new Error(`Unknown webhook event: ${event}`);
  return definition;
}

export function webhookExampleEnvelope(
  event: WebhookEvent,
  options: { test?: boolean } = {},
): Record<string, unknown> {
  return {
    id: "8c2a0e10-3f4b-4d5c-9e8f-7a6b5c4d3e2f",
    type: event,
    created_at: "2026-11-21T09:30:00.000Z",
    workspace_id: "3b4c5d6e-7f80-491a-8b2c-3d4e5f607182",
    ...(options.test ? { test: true } : {}),
    data: webhookEventDefinition(event).example,
  };
}

/** Every event the schema knows about must have a catalogue entry. */
export function assertWebhookCatalogueComplete(): void {
  const documented = new Set(WEBHOOK_EVENT_CATALOG.map((row) => row.event));
  for (const event of WEBHOOK_EVENTS) {
    if (!documented.has(event)) {
      throw new Error(`Webhook event ${event} has no catalogue entry.`);
    }
  }
}
