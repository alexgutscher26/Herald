import type { CustomerEventProperties } from "@/db/schema/events";

/**
 * Small, dependency-free client for `POST /api/v1/events`.
 *
 * Safe to import from a server or a script: it imports no database or
 * server-only module. The bearer token must stay server-side; never ship it to
 * a browser. Every call sends an `Idempotency-Key` so a retry cannot record the
 * same event twice.
 */

export type HeraldEventCustomer = {
  id?: string;
  externalId?: string;
  email?: string;
  name?: string;
};

export type HeraldTrackEventInput = {
  name: string;
  customer: HeraldEventCustomer;
  properties?: CustomerEventProperties;
  occurredAt?: Date | string;
  /** Your own event id; also used as the default idempotency key. */
  eventId?: string;
  idempotencyKey?: string;
};

export type HeraldTrackEventResult =
  | {
      ok: true;
      id: string;
      customerId: string;
      duplicate: boolean;
      occurredAt: string;
      receivedAt: string;
    }
  | {
      ok: false;
      status: number;
      error: string;
      details?: unknown;
    };

export type HeraldEventsClient = {
  track(input: HeraldTrackEventInput): Promise<HeraldTrackEventResult>;
};

export type HeraldEventsClientOptions = {
  /** Deployment origin, with or without a trailing `/api/v1`. */
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

function eventsEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/api/v1")
    ? `${trimmed}/events`
    : `${trimmed}/api/v1/events`;
}

function randomKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createHeraldEventsClient(
  options: HeraldEventsClientOptions,
): HeraldEventsClient {
  const endpoint = eventsEndpoint(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async track(input) {
      const body = {
        name: input.name,
        customer: {
          ...(input.customer.id ? { id: input.customer.id } : {}),
          ...(input.customer.externalId
            ? { external_id: input.customer.externalId }
            : {}),
          ...(input.customer.email ? { email: input.customer.email } : {}),
          ...(input.customer.name ? { name: input.customer.name } : {}),
        },
        ...(input.eventId ? { event_id: input.eventId } : {}),
        ...(input.occurredAt
          ? {
              occurred_at:
                input.occurredAt instanceof Date
                  ? input.occurredAt.toISOString()
                  : input.occurredAt,
            }
          : {}),
        ...(input.properties ? { properties: input.properties } : {}),
      };

      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.token}`,
            "content-type": "application/json",
            "idempotency-key":
              input.idempotencyKey ?? input.eventId ?? randomKey(),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
        });
      } catch (error) {
        return {
          ok: false,
          status: 0,
          error:
            error instanceof Error
              ? `Could not reach Herald: ${error.message}`
              : "Could not reach Herald.",
        };
      }

      const payload = (await response.json().catch(() => null)) as
        | {
            data?: {
              id?: string;
              customer_id?: string;
              duplicate?: boolean;
              occurred_at?: string;
              received_at?: string;
            };
            error?: { message?: string; details?: unknown };
          }
        | null;

      if (!response.ok || !payload?.data?.id) {
        return {
          ok: false,
          status: response.status,
          error: payload?.error?.message ?? `Herald answered ${response.status}.`,
          details: payload?.error?.details,
        };
      }

      return {
        ok: true,
        id: payload.data.id,
        customerId: payload.data.customer_id ?? "",
        duplicate: payload.data.duplicate === true,
        occurredAt: payload.data.occurred_at ?? "",
        receivedAt: payload.data.received_at ?? "",
      };
    },
  };
}
