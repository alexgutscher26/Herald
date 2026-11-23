/**
 * Dashboard shell smoke test.
 *
 * Every `/app/**` page is loaded once, with a real session, from a real
 * `next start` process, and the response must contain the resolved dashboard
 * shell with no boundary left permanently pending.
 *
 * Why this exists: the 2026-11-06 browser pass found `/app/*` routes whose
 * whole shell sat inside `div id="S:0" style="display:none"` with an empty
 * `template id="B:0"`, so the accessibility tree contained nothing but a
 * skeleton. Nothing caught it because every other test calls route handlers and
 * services directly and never streams a page. See HERALD_PLAN.md §13.2 and
 * docs/browser-verification.md.
 *
 * The routes are read from the filesystem, not a hand-written list, so a new
 * dashboard page is covered the day it is added.
 *
 * Requirements:
 *  - `TEST_DATABASE_URL` (a server whose role can CREATE DATABASE). The harness
 *    provisions `herald_test_*`, migrates it and drops it afterwards.
 *  - a production build: `bun run build`. Without `.next/BUILD_ID` the suite
 *    fails with that instruction rather than pretending it passed.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";

import { hashPassword } from "better-auth/crypto";

import { db } from "@/db";
import {
  account,
  conversations,
  customers,
  products,
  releases,
  user,
  workspaceMembers,
  workspaces,
} from "@/db/schema";

import {
  SETUP_TIMEOUT_MS,
  setupTestDatabase,
  teardownTestDatabase,
  testDatabaseConnectionString,
} from "./harness";

const BUILD_ID_PATH = path.join(process.cwd(), ".next", "BUILD_ID");
const DASHBOARD_APP_DIR = path.join(process.cwd(), "src", "app", "(dashboard)", "app");
const BOOT_TIMEOUT_MS = 120_000;
const PAGE_TIMEOUT_MS = 30_000;
const SUITE_TIMEOUT_MS = 300_000;

/**
 * A boundary that never resolved.
 *
 * Next streams a suspended subtree behind a sentinel `<div id="S:n">` and
 * reveals it later with `$RC("B:n","S:n")`. A resolved boundary leaves that
 * sentinel either `hidden` (unhidden by the reveal call) or removed; the shape
 * the 2026-11-06 pass observed was the sentinel still carrying
 * `style="display:none"`, which keeps the subtree out of the accessibility
 * tree forever. That is the signal this test asserts on.
 *
 * Two nearby shapes are deliberately NOT signals because healthy pages produce
 * them: an empty `<template id="B:n">` (the normal post-reveal state) and a
 * sentinel without a `$RC` call in the same document (later boundaries are
 * referenced from the flight payload, so a text scan cannot tell them apart).
 */
const HIDDEN_SENTINEL = /<div[^>]*id="S:\d+"[^>]*style="[^"]*display:\s*none/i;

export type PendingBoundary = "hidden-sentinel";

/** What is wrong with this document, if anything. Pure, so it can be tested. */
export function findPendingBoundary(html: string): PendingBoundary[] {
  return HIDDEN_SENTINEL.test(html) ? ["hidden-sentinel"] : [];
}

/** Dashboard routes, read from the app directory. */
export function collectDashboardRoutes(
  root: string = DASHBOARD_APP_DIR,
): string[] {
  const routes: string[] = [];

  const walk = (directory: string, segments: string[]) => {
    for (const entry of readdirSync(directory).sort()) {
      const full = path.join(directory, entry);
      const stats = statSync(full);
      if (stats.isDirectory()) {
        if (entry.startsWith("(") && entry.endsWith(")")) {
          // Route group: contributes no URL segment.
          walk(full, segments);
        } else {
          walk(full, [...segments, entry]);
        }
        continue;
      }
      if (entry !== "page.tsx") continue;
      routes.push(`/app${segments.length > 0 ? `/${segments.join("/")}` : ""}`);
    }
  };

  walk(root, []);
  return routes.sort();
}

/**
 * Fill `[param]` and `[[...param]]` segments with a fixture id.
 *
 * A parameter without a fixture gets a well-formed UUID, so the route still
 * runs and may render its own not-found page; the shell must resolve either
 * way.
 */
export function fillRoute(
  route: string,
  values: Record<string, string>,
  fallback = randomUUID(),
): string {
  return route
    .split("/")
    .map((segment) => {
      const match = segment.match(/^\[{1,2}(?:\.\.\.)?([^\]]+)\]{1,2}$/);
      if (!match?.[1]) return segment;
      return values[match[1]] ?? fallback;
    })
    .join("/");
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "string" || address === null) {
        server.close();
        reject(new Error("Could not reserve a port."));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(origin: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  let lastError = "no response";

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`next start exited early with code ${child.exitCode}.`);
    }
    try {
      const response = await fetch(`${origin}/sign-in`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await Bun.sleep(500);
  }

  throw new Error(`next start did not answer ${origin}/sign-in: ${lastError}`);
}

function cookieHeader(response: Response): string {
  const cookies = response.headers.getSetCookie?.() ?? [];
  const pairs = cookies.map((cookie) => cookie.split(";")[0]?.trim() ?? "");
  const kept = pairs.filter((pair) => pair.length > 0);
  if (kept.length === 0) {
    throw new Error("Sign-in did not return a session cookie.");
  }
  return kept.join("; ");
}

const previous: Record<string, string | undefined> = {};
let server: ChildProcess | null = null;
let origin = "";
let sessionCookie = "";
let workspaceSlug = "";
let productSlug = "";
let conversationId = "";
let releaseId = "";
const routes: string[] = [];

beforeAll(async () => {
  if (!existsSync(BUILD_ID_PATH)) {
    throw new Error(
      "No production build found. Run `bun run build` before this suite " +
        "(it loads the real pages from a real `next start`).",
    );
  }

  for (const key of ["BETTER_AUTH_URL", "BETTER_AUTH_SECRET", "DATABASE_URL"]) {
    previous[key] = process.env[key];
  }

  await setupTestDatabase();

  // Committed rows, not a rolled-back transaction: the server is a separate
  // process with its own connections, so it can only see committed data. The
  // harness drops this database at teardown, so nothing outlives the suite.
  const suffix = Date.now().toString(36);
  workspaceSlug = `smoke-${suffix}`;
  productSlug = `smoke-${suffix}`;

  const [owner] = await db
    .insert(user)
    .values({
      id: `smoke-user-${suffix}`,
      name: "Smoke Owner",
      email: `smoke-${suffix}@example.test`,
      emailVerified: true,
    })
    .returning();
  if (!owner) throw new Error("Could not create the smoke-test owner.");

  const [workspace] = await db
    .insert(workspaces)
    .values({ name: "Smoke", slug: workspaceSlug, plan: "pro", createdBy: owner.id })
    .returning();
  if (!workspace) throw new Error("Could not create the smoke-test workspace.");

  await db.insert(workspaceMembers).values({
    workspaceId: workspace.id,
    userId: owner.id,
    role: "owner",
  });

  const [product] = await db
    .insert(products)
    .values({
      workspaceId: workspace.id,
      name: "Smoke Product",
      slug: productSlug,
      publicFeedbackEnabled: true,
    })
    .returning();
  if (!product) throw new Error("Could not create the smoke-test product.");

  const [customer] = await db
    .insert(customers)
    .values({
      workspaceId: workspace.id,
      email: `customer-${suffix}@example.test`,
      emailNormalized: `customer-${suffix}@example.test`,
      name: "Smoke Customer",
    })
    .returning();
  if (!customer) throw new Error("Could not create the smoke-test customer.");

  const [conversation] = await db
    .insert(conversations)
    .values({
      workspaceId: workspace.id,
      productId: product.id,
      customerId: customer.id,
      subject: "Smoke conversation",
      status: "open",
      unreadForTeam: 0,
      unreadForCustomer: 0,
      lastMessagePreview: "A conversation for the dashboard shell test.",
      lastMessageAt: new Date(),
    })
    .returning();
  if (conversation) conversationId = conversation.id;

  const [release] = await db
    .insert(releases)
    .values({
      productId: product.id,
      title: "Smoke release",
      slug: `smoke-release-${suffix}`,
      bodyMarkdown: "A draft release for the dashboard shell test.",
      status: "draft",
    })
    .returning();
  if (release) releaseId = release.id;

  const port = await freePort();
  origin = `http://localhost:${port}`;

  // The server must talk to the disposable database and the same auth origin
  // the cookies are issued for.
  process.env.BETTER_AUTH_URL = origin;
  process.env.BETTER_AUTH_SECRET = "integration-secret-value-at-least-32-chars";

  const password = `smoke-password-${suffix}`;
  await db.insert(account).values({
    id: `smoke-account-${suffix}`,
    accountId: owner.id,
    providerId: "credential",
    userId: owner.id,
    password: await hashPassword(password),
  });

  server = spawn("bun", ["--bun", "next", "start", "-p", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      DATABASE_URL: testDatabaseConnectionString(),
      BETTER_AUTH_URL: origin,
      BETTER_AUTH_SECRET: "integration-secret-value-at-least-32-chars",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stderr: string[] = [];
  server.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk.toString()));
  server.once("exit", (code) => {
    if (code !== 0 && code !== null) {
      stderr.push(`next start exited with ${code}`);
    }
  });

  try {
    await waitForServer(origin, server);
  } catch (error) {
    const detail = stderr.join("").slice(-2_000);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n${detail}`,
    );
  }

  const signIn = await fetch(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ email: owner.email, password }),
  });
  if (!signIn.ok) {
    throw new Error(
      `Sign-in failed with HTTP ${signIn.status}: ${(await signIn.text()).slice(0, 300)}`,
    );
  }
  sessionCookie = cookieHeader(signIn);

  routes.push(...collectDashboardRoutes());
}, SETUP_TIMEOUT_MS + BOOT_TIMEOUT_MS);

afterAll(async () => {
  server?.kill();
  server = null;

  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

describe("dashboard shell", () => {
  test("the pending-boundary detector recognises both failure shapes", () => {
    expect(findPendingBoundary("<p>ok</p>")).toEqual([]);
    expect(
      findPendingBoundary('<div id="S:0" style="display:none"><main></main></div>'),
    ).toEqual(["hidden-sentinel"]);
    // The healthy shapes: revealed via $RC, or already unhidden.
    expect(
      findPendingBoundary(
        '<div hidden id="S:0"><main>done</main></div><template id="B:0"></template>' +
          '<script>$RC("B:0","S:0")</script>',
      ),
    ).toEqual([]);
    expect(findPendingBoundary('<div hidden id="S:0"><main>done</main></div>')).toEqual(
      [],
    );
  });

  test("every dashboard route is enumerated from the filesystem", () => {
    expect(routes).toContain("/app");
    expect(routes).toContain("/app/[workspaceSlug]/[productSlug]");
    expect(routes).toContain("/app/[workspaceSlug]/[productSlug]/widget");
    expect(routes).toContain("/app/[workspaceSlug]/settings");
    expect(routes.length).toBeGreaterThan(20);
  });

  test(
    "each dashboard route renders a resolved shell for a signed-in owner",
    async () => {
      const values = {
        workspaceSlug,
        productSlug,
        conversationId,
        releaseId,
      };

      const failures: string[] = [];

      for (const route of routes) {
        const pathname = fillRoute(route, values);
        const response = await fetch(`${origin}${pathname}`, {
          headers: { cookie: sessionCookie },
          redirect: "follow",
          signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
        }).catch((error: unknown) => {
          failures.push(
            `${pathname} — request failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return null;
        });
        if (!response) continue;

        const html = await response.text();
        const finalPath = new URL(response.url).pathname;

        if (response.status >= 500) {
          failures.push(`${pathname} — HTTP ${response.status}`);
          continue;
        }
        if (finalPath.endsWith("/sign-in")) {
          failures.push(`${pathname} — redirected to sign-in; the session was not used`);
          continue;
        }

        const boundaries = findPendingBoundary(html);
        if (boundaries.length > 0) {
          failures.push(
            `${pathname} — permanently pending boundary (${boundaries.join(", ")})`,
          );
          continue;
        }

        // A completed response ends with </html>. If it does not, the stream
        // was cut short and the browser would keep waiting on the boundary.
        if (!html.includes("</html>")) {
          failures.push(
            `${pathname} — response did not complete (${html.length} bytes, HTTP ${response.status})`,
          );
        }
      }

      expect(failures).toEqual([]);
    },
    SUITE_TIMEOUT_MS,
  );
});
