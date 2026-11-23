import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { NextRequest } from "next/server";

import { POST as identifyCustomerRoute } from "@/app/api/public/session/identify/route";
import { POST as outboundEvent } from "@/app/api/public/outbound/route";
import { POST as emailPreferences } from "@/app/api/public/email-preferences/route";
import { POST as magicLink } from "@/app/api/public/auth/magic-link/route";
import { POST as widgetEvent } from "@/app/api/public/widget/events/route";
import { POST as conversationStart } from "@/app/api/public/conversations/route";
import { POST as experienceView } from "@/app/api/public/widget/experiences/[experienceId]/view/route";

import {
  SETUP_TIMEOUT_MS,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";

/**
 * Every anonymous write is throttled.
 *
 * The first test is a source-level gate: a new public POST route cannot ship
 * without a limiter. Two files are allowlisted because the check happens one
 * layer below the route (the API token authenticator and the shared SSO
 * handler), and that is stated here rather than inferred.
 *
 * The behavioural tests then call real route handlers with the same
 * `x-forwarded-for` until the route answers 429. Invalid bodies are fine: the
 * limiter is the first gate, so a 400 means "still under the limit" and a 429
 * proves the gate exists. Each test runs in a rolled-back transaction, so the
 * counters disappear with it.
 */

const PUBLIC_ROOT = path.join(process.cwd(), "src/app/api/public");
/** `rejectCrossOrigin` compares against the configured app origin. */
const ORIGIN = new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000").origin;

/** Route files whose limiter lives in the shared handler they call. */
const DELEGATED_LIMITER = new Set([
  "api-docs/playground/route.ts", // bearer auth -> authenticateApiRequest() consumes the token bucket
  "session/sso/route.ts", // handleSsoIdentify() consumes customer-sso:identify
]);

async function routeFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await routeFiles(absolute)));
    else if (entry.name === "route.ts") files.push(absolute);
  }
  return files;
}

beforeAll(async () => {
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

describe("public write rate limits", () => {
  test("every public POST route installs a limiter", async () => {
    const offenders: string[] = [];

    for (const file of await routeFiles(PUBLIC_ROOT)) {
      const source = await readFile(file, "utf8");
      if (!/export async function POST|export const POST/.test(source)) continue;

      const relative = path.relative(PUBLIC_ROOT, file).replaceAll("\\", "/");
      if (DELEGATED_LIMITER.has(relative)) continue;

      const limited =
        source.includes("consumeRateLimit") ||
        source.includes("enforcePublicWriteLimit");
      if (!limited) offenders.push(relative);
    }

    expect(offenders).toEqual([]);
  });

  test(
    "the shared gate answers 429 with Retry-After",
    async () => {
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const response = await conversationStart(
          new NextRequest(new URL("/api/public/conversations", ORIGIN), {
            method: "POST",
            headers: {
              origin: ORIGIN,
              "x-forwarded-for": "203.0.113.10",
              "content-type": "application/json",
            },
            body: "{}",
          }),
        );
        statuses.push(response.status);
        if (response.status === 429) {
          expect(response.headers.get("retry-after")).toBe("60");
          break;
        }
      }

      expect(statuses.at(-1)).toBe(429);
      expect(statuses.filter((status) => status === 429)).toHaveLength(1);
    },
    30_000,
  );

  const cases: Array<{
    name: string;
    method: 0 | 1; // unused; keeps the table readable
    run: (ip: string) => Promise<Response>;
    max: number;
  }> = [
    {
      name: "customer identify",
      method: 0,
      max: 15,
      run: (ip) =>
        identifyCustomerRoute(
          new NextRequest(new URL("/api/public/session/identify", ORIGIN), {
            method: "POST",
            headers: {
              origin: ORIGIN,
              "x-forwarded-for": ip,
              "content-type": "application/json",
            },
            body: "{}",
          }),
        ),
    },
    {
      name: "magic link request",
      method: 0,
      max: 10,
      run: (ip) =>
        magicLink(
          new NextRequest(new URL("/api/public/auth/magic-link", ORIGIN), {
            method: "POST",
            headers: {
              origin: ORIGIN,
              "x-forwarded-for": ip,
              "content-type": "application/json",
            },
            body: "{}",
          }),
        ),
    },
    {
      name: "email preferences",
      method: 0,
      max: 25,
      run: (ip) =>
        emailPreferences(
          new NextRequest(new URL("/api/public/email-preferences", ORIGIN), {
            method: "POST",
            headers: {
              origin: ORIGIN,
              "x-forwarded-for": ip,
              "content-type": "application/json",
            },
            body: "{}",
          }),
        ),
    },
    {
      name: "widget events",
      method: 0,
      max: 65,
      run: (ip) =>
        widgetEvent(
          new NextRequest(new URL("/api/public/widget/events", ORIGIN), {
            method: "POST",
            headers: {
              "x-forwarded-for": ip,
              "content-type": "application/json",
            },
            body: "{}",
          }),
        ),
    },
    {
      name: "outbound event",
      method: 0,
      max: 125,
      run: (ip) =>
        outboundEvent(
          new NextRequest(new URL("/api/public/outbound", ORIGIN), {
            method: "POST",
            headers: {
              origin: ORIGIN,
              "x-forwarded-for": ip,
              "content-type": "application/json",
            },
            body: "{}",
          }),
        ),
    },
    {
      name: "conversation start",
      method: 0,
      max: 15,
      run: (ip) =>
        conversationStart(
          new NextRequest(new URL("/api/public/conversations", ORIGIN), {
            method: "POST",
            headers: {
              origin: ORIGIN,
              "x-forwarded-for": ip,
              "content-type": "application/json",
            },
            body: "{}",
          }),
        ),
    },
    {
      name: "experience view",
      method: 0,
      max: 125,
      run: (ip) =>
        experienceView(
          new NextRequest(
            new URL(
              "/api/public/widget/experiences/00000000-0000-4000-8000-000000000000/view",
              ORIGIN,
            ),
            {
              method: "POST",
              headers: {
                origin: ORIGIN,
                "x-forwarded-for": ip,
                "content-type": "application/json",
              },
              body: "{}",
            },
          ),
          {
            params: Promise.resolve({
              experienceId: "00000000-0000-4000-8000-000000000000",
            }),
          },
        ),
    },
  ];

  for (const [index, entry] of cases.entries()) {
    test(
      `${entry.name} throttles repeated writes`,
      async () => {
        const ip = `198.51.100.${index + 1}`;
        let limited: Response | null = null;

        for (let attempt = 0; attempt < entry.max; attempt += 1) {
          const response = await entry.run(ip);
          if (response.status === 429) {
            limited = response;
            break;
          }
        }

        // Some routes predate the shared helper and use `jsonError(429)`, so
        // only the shared-gate test above asserts Retry-After.
        expect(limited?.status).toBe(429);
      },
      60_000,
    );
  }
});
