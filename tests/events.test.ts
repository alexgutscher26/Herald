import { describe, expect, test } from "bun:test";

import { createHeraldEventsClient } from "@/features/api-v1/events-sdk";

/**
 * Contract tests for the event SDK helper. The fake fetch records exactly what
 * would go over the wire; no network and no database.
 */

type Captured = { url: string; init: RequestInit };

function fakeFetch(
  captured: Captured[],
  respond: () => Response | Promise<Response>,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.push({ url: String(input), init: init ?? {} });
    return respond();
  }) as unknown as typeof fetch;
}

function successResponse(duplicate = false): Response {
  return new Response(
    JSON.stringify({
      data: {
        id: "f4b7c0de-0000-4000-8000-000000000001",
        name: "report.exported",
        customer_id: "f4b7c0de-0000-4000-8000-000000000002",
        external_id: "user_123",
        duplicate,
        occurred_at: "2026-02-03T04:05:06.000Z",
        received_at: "2026-02-03T04:05:07.000Z",
      },
    }),
    { status: duplicate ? 200 : 201, headers: { "content-type": "application/json" } },
  );
}

describe("event SDK helper", () => {
  test("posts a workspace-scoped event with bearer auth and the event id as idempotency key", async () => {
    const captured: Captured[] = [];
    const client = createHeraldEventsClient({
      baseUrl: "https://herald.example/",
      token: "hrl_test_token",
      fetchImpl: fakeFetch(captured, () => successResponse()),
    });

    const result = await client.track({
      name: "report.exported",
      customer: { externalId: "user_123", email: "ada@example.com" },
      eventId: "evt_01HZX5R8K4",
      properties: { format: "csv", rows: 1200, scheduled: false, note: null },
    });

    expect(result).toMatchObject({
      ok: true,
      id: "f4b7c0de-0000-4000-8000-000000000001",
      customerId: "f4b7c0de-0000-4000-8000-000000000002",
      duplicate: false,
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe("https://herald.example/api/v1/events");

    const headers = new Headers(captured[0]?.init.headers);
    expect(headers.get("authorization")).toBe("Bearer hrl_test_token");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("idempotency-key")).toBe("evt_01HZX5R8K4");

    expect(JSON.parse(String(captured[0]?.init.body))).toEqual({
      name: "report.exported",
      customer: { external_id: "user_123", email: "ada@example.com" },
      event_id: "evt_01HZX5R8K4",
      properties: { format: "csv", rows: 1200, scheduled: false, note: null },
    });
  });

  test("accepts a base URL that already ends in /api/v1 and serializes a Date", async () => {
    const captured: Captured[] = [];
    const client = createHeraldEventsClient({
      baseUrl: "https://herald.example/api/v1/",
      token: "hrl_test_token",
      fetchImpl: fakeFetch(captured, () => successResponse(true)),
    });

    const result = await client.track({
      name: "trial.started",
      customer: { id: "f4b7c0de-0000-4000-8000-000000000002" },
      occurredAt: new Date("2026-02-03T04:05:06.000Z"),
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.duplicate).toBe(true);
    expect(captured[0]?.url).toBe("https://herald.example/api/v1/events");
    expect(JSON.parse(String(captured[0]?.init.body))).toEqual({
      name: "trial.started",
      customer: { id: "f4b7c0de-0000-4000-8000-000000000002" },
      occurred_at: "2026-02-03T04:05:06.000Z",
    });
  });

  test("generates an idempotency key when the caller supplies neither key nor event id", async () => {
    const captured: Captured[] = [];
    const client = createHeraldEventsClient({
      baseUrl: "https://herald.example",
      token: "hrl_test_token",
      fetchImpl: fakeFetch(captured, () => successResponse()),
    });

    await client.track({ name: "page.viewed", customer: { email: "ada@example.com" } });

    const key = new Headers(captured[0]?.init.headers).get("idempotency-key");
    expect(key).toBeTruthy();
    expect(key!.length).toBeGreaterThan(8);
  });

  test("returns the API error message and details instead of throwing", async () => {
    const captured: Captured[] = [];
    const client = createHeraldEventsClient({
      baseUrl: "https://herald.example",
      token: "hrl_test_token",
      fetchImpl: fakeFetch(
        captured,
        () =>
          new Response(
            JSON.stringify({
              error: {
                code: "validation_failed",
                message: "Check the request fields.",
                details: { name: ["Required"] },
              },
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          ),
      ),
    });

    const result = await client.track({ name: "x", customer: { email: "a@b.co" } });
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Check the request fields.",
      details: { name: ["Required"] },
    });
  });

  test("reports a transport failure without throwing", async () => {
    const client = createHeraldEventsClient({
      baseUrl: "https://herald.example",
      token: "hrl_test_token",
      fetchImpl: fakeFetch([], () => {
        throw new Error("socket closed");
      }),
    });

    const result = await client.track({ name: "x", customer: { email: "a@b.co" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(0);
  });
});
