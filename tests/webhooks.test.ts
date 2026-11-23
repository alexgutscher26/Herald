import { describe, expect, test } from "bun:test";

import {
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_DELAYS_MS,
  WebhookUrlValidation,
  createWebhookSecret,
  nextAttemptDelayMs,
  signWebhookPayload,
  validateWebhookUrl,
  verifyWebhookSignature,
} from "@/features/webhooks/sign";
import {
  WEBHOOK_EVENT_CATALOG,
  assertWebhookCatalogueComplete,
  webhookExampleEnvelope,
} from "@/features/webhooks/catalog";

/**
 * Pure webhook contract: secret shape, HMAC verification, retry policy and the
 * destination rules that keep a workspace from pointing a webhook at the
 * deployment's own network.
 */

describe("webhook signing", () => {
  test("creates a prefixed, high-entropy secret", () => {
    const first = createWebhookSecret();
    const second = createWebhookSecret();

    expect(first).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(second);
  });

  test("signs the timestamp and raw body deterministically", () => {
    const signature = signWebhookPayload("whsec_test_secret_1234567890", "1700000000", '{"a":1}');

    expect(signature).toMatch(/^v1=[a-f0-9]{64}$/);
    expect(signature).toBe(
      signWebhookPayload("whsec_test_secret_1234567890", "1700000000", '{"a":1}'),
    );
    expect(signature).not.toBe(
      signWebhookPayload("whsec_test_secret_1234567890", "1700000001", '{"a":1}'),
    );
    expect(signature).not.toBe(
      signWebhookPayload("whsec_test_secret_1234567890", "1700000000", '{"a":2}'),
    );
  });

  test("accepts a fresh valid signature and rejects tampering", () => {
    const secret = "whsec_test_secret_1234567890";
    const timestamp = "1700000000";
    const body = '{"event":"request.created"}';
    const signature = signWebhookPayload(secret, timestamp, body);
    const now = 1_700_000_000_000;

    expect(
      verifyWebhookSignature({ secret, timestamp, body, signature, now }),
    ).toBe(true);
    expect(
      verifyWebhookSignature({ secret, timestamp, body: `${body} `, signature, now }),
    ).toBe(false);
    expect(
      verifyWebhookSignature({ secret: `${secret}x`, timestamp, body, signature, now }),
    ).toBe(false);
    expect(
      verifyWebhookSignature({
        secret,
        timestamp: "1700000001",
        body,
        signature,
        now,
      }),
    ).toBe(false);
    expect(
      verifyWebhookSignature({
        secret,
        timestamp,
        body,
        signature: "v1=deadbeef",
        now,
      }),
    ).toBe(false);
  });

  test("rejects stale and malformed timestamps", () => {
    const secret = "whsec_test_secret_1234567890";
    const timestamp = "1700000000";
    const body = "{}";
    const signature = signWebhookPayload(secret, timestamp, body);

    expect(
      verifyWebhookSignature({
        secret,
        timestamp,
        body,
        signature,
        now: 1_700_000_000_000 + 301_000,
      }),
    ).toBe(false);
    expect(
      verifyWebhookSignature({
        secret,
        timestamp,
        body,
        signature,
        now: 1_700_000_000_000 + 60_000,
      }),
    ).toBe(true);
    expect(
      verifyWebhookSignature({ secret, timestamp: "soon", body, signature }),
    ).toBe(false);
  });
});

describe("webhook retry policy", () => {
  test("backs off exponentially with bounded jitter", () => {
    expect(nextAttemptDelayMs(1, 0.5)).toBe(30_000);
    expect(nextAttemptDelayMs(2, 0.5)).toBe(120_000);
    expect(nextAttemptDelayMs(3, 0.5)).toBe(480_000);
    expect(nextAttemptDelayMs(4, 0.5)).toBe(1_920_000);
    expect(nextAttemptDelayMs(5, 0.5)).toBe(7_680_000);
    expect(nextAttemptDelayMs(99, 0.5)).toBe(7_680_000);
    expect(nextAttemptDelayMs(0, 0.5)).toBe(30_000);
    expect(nextAttemptDelayMs(1, 0)).toBe(24_000);
    expect(nextAttemptDelayMs(1, 1)).toBe(36_000);
    expect(WEBHOOK_RETRY_DELAYS_MS).toHaveLength(WEBHOOK_MAX_ATTEMPTS);
  });

  test("has a catalogue payload for every event", () => {
    expect(() => assertWebhookCatalogueComplete()).not.toThrow();
    expect(WEBHOOK_EVENT_CATALOG).toHaveLength(7);
    for (const definition of WEBHOOK_EVENT_CATALOG) {
      const envelope = webhookExampleEnvelope(definition.event, { test: true });
      expect(envelope.type).toBe(definition.event);
      expect(envelope.test).toBe(true);
      expect(envelope.data).toEqual(definition.example);
    }
  });
});

describe("webhook destinations", () => {
  test("accepts public http(s) URLs without credentials", () => {
    for (const url of [
      "https://hooks.example.com/herald",
      "http://example.com:8080/hook?tenant=1",
    ]) {
      const result = validateWebhookUrl(url);
      expect(result.ok).toBe(true);
    }
  });

  test("rejects non-http, credentialed and fragmented URLs", () => {
    for (const url of [
      "ftp://example.com/hook",
      "file:///etc/passwd",
      "https://user:pass@example.com/hook",
      "https://example.com/hook#secret",
      "not a url",
    ]) {
      expect(validateWebhookUrl(url).ok).toBe(false);
    }
  });

  test("blocks loopback, private and link-local hosts by default", () => {
    const blocked = [
      "http://localhost:3000/hook",
      "http://app.localhost/hook",
      "http://service.local/hook",
      "http://127.0.0.1/hook",
      "http://127.10.0.1/hook",
      "http://10.0.0.5/hook",
      "http://172.16.0.1/hook",
      "http://172.31.255.254/hook",
      "http://192.168.1.10/hook",
      "http://169.254.169.254/latest/meta-data",
      "http://100.64.0.1/hook",
      "http://198.18.0.1/hook",
      "http://[::1]/hook",
      "http://[fd00::1]/hook",
      "http://0.0.0.0/hook",
    ];

    for (const url of blocked) {
      const result: WebhookUrlValidation = validateWebhookUrl(url);
      expect(result.ok).toBe(false);
    }
  });

  test("allows loopback only when explicitly opted in for local tests", () => {
    const result = validateWebhookUrl("http://127.0.0.1:4100/hook", {
      allowPrivate: true,
    });
    expect(result.ok).toBe(true);
  });
});
