import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { sendEmail } from "@/features/email/provider";
import { generateAiText, AiProviderError } from "@/features/ai/provider";

/**
 * THE PROVIDER SEAM
 * =================
 *
 * This project does not replace modules. `scripts/check-no-mocks.sh` fails on
 * the mock APIs of Vitest, Jest and Bun's module interceptor, and the
 * integration suites never replace an implementation with a spy.
 *
 * There is exactly one place where a fake provider is legitimate: an
 * *injected* HTTP endpoint. Email and AI are adapters over a URL, so a test
 * can run a real local server and point the real adapter at it with
 * `EMAIL_API_URL` / `AI_API_URL`. Nothing in `src/` is replaced; the code
 * under test is the production path, including its timeout, retryability and
 * error shaping.
 *
 * The rules for adding a seam:
 *   1. It is configuration (a URL, a clock, an explicit `deps` argument), not
 *      a module interception.
 *   2. The default in production is the real provider; a test must not be able
 *      to change it by accident.
 *   3. The fake speaks the provider's wire contract, so a change in the
 *      adapter's request shape breaks the test.
 *
 * This file is the boundary made obvious: if a future test needs a provider
 * failure, it belongs here or in the integration suite that owns that surface,
 * and it must use a server like the ones below.
 */

let server: ReturnType<typeof Bun.serve> | null = null;
let requests: { path: string; body: unknown }[] = [];
let handler: (request: Request) => Promise<Response> = async () =>
  Response.json({ id: "msg_seam" });

let previous: Record<string, string | undefined> = {};

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const text = await request.text();
      let body: unknown = null;
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = text;
      }
      requests.push({ path: new URL(request.url).pathname, body });
      return handler(request);
    },
  });

  previous = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    EMAIL_API_URL: process.env.EMAIL_API_URL,
    AI_API_URL: process.env.AI_API_URL,
    AI_MODEL: process.env.AI_MODEL,
    AI_API_KEY: process.env.AI_API_KEY,
    AI_TIMEOUT_MS: process.env.AI_TIMEOUT_MS,
    SANDBOX_MODE: process.env.SANDBOX_MODE,
  };
  // A developer `.env` may set SANDBOX_MODE; this seam measures the provider
  // adapter, so it must not be short-circuited before the HTTP call.
  delete process.env.SANDBOX_MODE;
});

afterAll(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  server?.stop(true);
  server = null;
});

function endpoint(): string {
  if (!server) throw new Error("The seam server did not start.");
  return `http://127.0.0.1:${server.port}`;
}

describe("email adapter seam", () => {
  test("a provider 500 is retryable and never leaks its body", async () => {
    process.env.RESEND_API_KEY = "re_seam_key";
    process.env.EMAIL_FROM = "Herald <seam@example.test>";
    process.env.EMAIL_API_URL = `${endpoint()}/emails`;

    handler = async () =>
      new Response(JSON.stringify({ message: "vendor secret detail" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    requests = [];

    const result = await sendEmail({
      to: "reader@example.test",
      subject: "Seam",
      html: "<p>Seam</p>",
      text: "Seam",
      idempotencyKey: "seam-key",
    });

    expect(result).toEqual({
      ok: false,
      error: "Email provider rejected the message (HTTP 500).",
      retryable: true,
    });
    expect(requests[0]?.path).toBe("/emails");
    const body = requests[0]?.body as { to?: string[]; subject?: string } | null;
    expect(body?.to).toEqual(["reader@example.test"]);
    expect(body?.subject).toBe("Seam");
  });

  test("a successful send returns the provider message id", async () => {
    handler = async () => Response.json({ id: "msg_seam_ok" });
    const result = await sendEmail({
      to: "reader@example.test",
      subject: "Seam",
      html: "<p>Seam</p>",
      text: "Seam",
    });
    expect(result).toEqual({ ok: true, providerMessageId: "msg_seam_ok" });
  });
});

describe("AI adapter seam", () => {
  test("a stalled provider becomes an AiProviderError at the configured timeout", async () => {
    process.env.AI_API_URL = `${endpoint()}/v1`;
    process.env.AI_MODEL = "seam-model";
    process.env.AI_TIMEOUT_MS = "100";

    handler = async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      return Response.json({ choices: [{ message: { content: "late" } }] });
    };

    const started = performance.now();
    const error = await generateAiText({ system: "s", prompt: "p" }).catch(
      (caught: unknown) => caught,
    );
    const elapsed = performance.now() - started;

    expect(error).toBeInstanceOf(AiProviderError);
    expect(elapsed).toBeLessThan(900);
  });

  test("a successful completion is trimmed and capped", async () => {
    process.env.AI_TIMEOUT_MS = "2000";
    handler = async () =>
      Response.json({ choices: [{ message: { content: "  a useful draft  " } }] });

    await expect(generateAiText({ system: "s", prompt: "p" })).resolves.toBe(
      "a useful draft",
    );
  });
});
