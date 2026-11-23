import { describe, expect, test } from "bun:test";

import {
  signSlackRequest,
  verifySlackSignature,
} from "@/features/slack/sign";

const SECRET = "slack-signing-secret-for-tests";
const NOW = 1_800_000_000_000;

describe("Slack request signatures", () => {
  test("accepts a fresh signature over the raw body", () => {
    const timestamp = String(Math.floor(NOW / 1000));
    const body = '{"type":"event_callback"}';
    const signature = signSlackRequest(SECRET, timestamp, body);

    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        timestamp,
        body,
        signature,
        now: NOW,
      }),
    ).toBe(true);
  });

  test("rejects a changed body, wrong secret and stale timestamp", () => {
    const timestamp = String(Math.floor(NOW / 1000));
    const body = '{"type":"event_callback"}';
    const signature = signSlackRequest(SECRET, timestamp, body);

    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        timestamp,
        body: `${body} `,
        signature,
        now: NOW,
      }),
    ).toBe(false);
    expect(
      verifySlackSignature({
        signingSecret: "another-secret",
        timestamp,
        body,
        signature,
        now: NOW,
      }),
    ).toBe(false);
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        timestamp,
        body,
        signature,
        now: NOW + 301_000,
      }),
    ).toBe(false);
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        timestamp: null,
        body,
        signature,
        now: NOW,
      }),
    ).toBe(false);
  });
});
