/**
 * Content-Security-Policy regression test.
 *
 * Four public surfaces plus the dashboard are loaded from a real `next start`
 * process, and each served document is audited against the policy that came
 * back with it: every script, stylesheet, frame and image the HTML references
 * must be allowed by the report-only policy, so a new third-party host (or an
 * inline script after `unsafe-inline` is dropped) fails here instead of showing
 * up as a console violation in production.
 *
 * The same responses are checked for the framing decision, which is the only
 * part of the policy already enforced: the widget embed must name the
 * workspace's allowed origins and must not send `X-Frame-Options`, while every
 * other surface must be `frame-ancestors 'none'` with `X-Frame-Options:
 * SAMEORIGIN`.
 *
 * What this cannot see: violations a browser discovers at runtime (an `eval`,
 * a fetch to a host chosen by JavaScript). Those need a browser and a report
 * endpoint; this test covers the resources the server actually emits.
 *
 * Requirements: `TEST_DATABASE_URL` (a server whose role can CREATE DATABASE)
 * and a production build (`bun run build`).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";

import { hashPassword } from "better-auth/crypto";

import { db } from "@/db";
import { account, workspaceWidgetSettings } from "@/db/schema";

import {
  createBoard,
  createMember,
  createProduct,
  createRelease,
  createUser,
  createWorkspace,
} from "./factories";
import {
  SETUP_TIMEOUT_MS,
  setupTestDatabase,
  teardownTestDatabase,
  testDatabaseConnectionString,
} from "./harness";

const BUILD_ID_PATH = path.join(process.cwd(), ".next", "BUILD_ID");
const BOOT_TIMEOUT_MS = 120_000;
const PAGE_TIMEOUT_MS = 30_000;
const SUITE_TIMEOUT_MS = 300_000;

/** A parsed policy: directive name to its source list. */
export type CspPolicy = Map<string, string[]>;

export function parseCsp(header: string): CspPolicy {
  const policy: CspPolicy = new Map();

  for (const part of header.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    const name = tokens[0];
    if (!name) continue;
    policy.set(name.toLowerCase(), tokens.slice(1));
  }

  return policy;
}

/** The sources that govern a directive, honouring the `default-src` fallback. */
function sourcesFor(policy: CspPolicy, directive: string): string[] | null {
  const direct = policy.get(directive);
  if (direct) return direct;
  // `form-action` has no fallback; unset means the directive is not restricted.
  if (directive === "form-action") return null;
  return policy.get("default-src") ?? null;
}

function allowedBy(sources: string[], url: URL, pageOrigin: string): boolean {
  if (sources.length === 1 && sources[0] === "'none'") return false;

  return sources.some((raw) => {
    const source = raw.toLowerCase();

    if (source === "'self'") return url.origin === pageOrigin;
    if (source === "*") {
      return url.protocol === "http:" || url.protocol === "https:";
    }
    if (source === "data:" || source === "blob:" || source === "mediastream:") {
      return url.protocol === source;
    }
    // Any other keyword ('unsafe-inline', a nonce, a hash) does not name a host.
    if (source.startsWith("'")) return false;
    if (!source.includes("://")) return false;

    try {
      return new URL(source).origin === url.origin;
    } catch {
      return false;
    }
  });
}

function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i"));
  return match?.[1] === undefined ? null : match[1].replace(/&amp;/g, "&");
}

/**
 * Every subresource in the document that the policy would block.
 *
 * Mirrors what a browser decides for the elements the server emits, which is
 * where policy drift actually comes from: a new CDN, player or font host.
 */
export function findPolicyViolations(
  html: string,
  policy: CspPolicy,
  pageOrigin: string,
): string[] {
  const violations: string[] = [];

  const check = (directive: string, value: string) => {
    const trimmed = value.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return;

    let url: URL;
    try {
      url = new URL(trimmed, pageOrigin);
    } catch {
      return;
    }
    if (!["http:", "https:", "data:", "blob:"].includes(url.protocol)) return;

    const sources = sourcesFor(policy, directive);
    if (!sources) return;
    if (!allowedBy(sources, url, pageOrigin)) {
      violations.push(`${directive} blocks ${trimmed}`);
    }
  };

  for (const match of html.matchAll(/<(script|link|iframe|img|form)\b[^>]*>/gi)) {
    const tag = match[0];
    const name = (match[1] ?? "").toLowerCase();

    if (name === "script") {
      const src = attribute(tag, "src");
      if (src) check("script-src", src);
      continue;
    }
    if (name === "link") {
      const rel = (attribute(tag, "rel") ?? "").toLowerCase().split(/\s+/);
      if (!rel.includes("stylesheet")) continue;
      const href = attribute(tag, "href");
      if (href) check("style-src", href);
      continue;
    }
    if (name === "iframe") {
      const src = attribute(tag, "src");
      if (src) check("frame-src", src);
      continue;
    }
    if (name === "img") {
      const src = attribute(tag, "src");
      if (src) check("img-src", src);
      continue;
    }
    const action = attribute(tag, "action");
    if (action) check("form-action", action);
  }

  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const opening = match[0].slice(0, match[0].indexOf(">") + 1);
    if (attribute(opening, "src")) continue;
    if ((match[1] ?? "").trim() === "") continue;

    const sources = sourcesFor(policy, "script-src") ?? [];
    if (!sources.includes("'unsafe-inline'")) {
      violations.push("script-src blocks an inline script");
    }
  }

  return violations;
}

type Surface = {
  name: string;
  path: string;
  /** Expected `frame-ancestors` value. */
  frameAncestors: string;
  /** Expected `X-Frame-Options`, or null when the response must omit it. */
  xFrameOptions: string | null;
  displayCapture: boolean;
  /** Send the signed-in dashboard session. */
  session?: boolean;
  /** A string the rendered document must contain, proving it is not a 404. */
  contains?: string;
  /**
   * A frame origin the report-only policy must allow even when the document
   * does not request it yet (a consent-gated embed).
   */
  frameSrcMustAllow?: string;
};

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

const previous: Record<string, string | undefined> = {};
let server: ChildProcess | null = null;
let origin = "";
let sessionCookie = "";
let surfaces: Surface[] = [];

beforeAll(async () => {
  if (!existsSync(BUILD_ID_PATH)) {
    throw new Error(
      "No production build found. Run `bun run build` before this suite " +
        "(it audits the pages a real `next start` serves).",
    );
  }

  for (const key of ["BETTER_AUTH_URL", "BETTER_AUTH_SECRET", "DATABASE_URL"]) {
    previous[key] = process.env[key];
  }

  await setupTestDatabase();

  const suffix = Date.now().toString(36);
  const owner = await createUser({ name: "CSP Owner" });
  const workspace = await createWorkspace({ plan: "pro" });
  await createMember(workspace.id, { user: owner, role: "owner" });

  const product = await createProduct(workspace.id, {
    publicFeedbackEnabled: true,
    publicRoadmapEnabled: true,
    publicChangelogEnabled: true,
  });
  const board = await createBoard(product.id, { slug: "requests", position: 0 });
  const release = await createRelease({
    productId: product.id,
    slug: "video-update",
    title: "Video update",
    youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  });

  const hostOrigin = "https://host.example.test";
  const publicKey = `hpk_${randomBytes(24).toString("base64url")}`;
  await db.insert(workspaceWidgetSettings).values({
    workspaceId: workspace.id,
    publicKey,
    allowedOrigins: [hostOrigin],
  });

  const port = await freePort();
  origin = `http://localhost:${port}`;

  const password = `csp-password-${suffix}`;
  await db.insert(account).values({
    id: `csp-account-${suffix}`,
    accountId: owner.id,
    providerId: "credential",
    userId: owner.id,
    password: await hashPassword(password),
  });

  process.env.BETTER_AUTH_URL = origin;
  process.env.BETTER_AUTH_SECRET = "integration-secret-value-at-least-32-chars";

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
  sessionCookie = (signIn.headers.getSetCookie?.() ?? [])
    .map((cookie) => cookie.split(";")[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");
  if (sessionCookie === "") throw new Error("Sign-in did not return a cookie.");

  const frame = new URLSearchParams({ host: hostOrigin, key: publicKey });
  const base = `/p/${workspace.slug}/${product.slug}`;

  surfaces = [
    {
      name: "dashboard",
      path: `/app/${workspace.slug}/${product.slug}`,
      frameAncestors: "'none'",
      xFrameOptions: "SAMEORIGIN",
      displayCapture: false,
      session: true,
    },
    {
      name: "public board",
      path: `${base}/${board.slug}`,
      frameAncestors: "'none'",
      xFrameOptions: "SAMEORIGIN",
      displayCapture: false,
    },
    {
      name: "changelog entry with a video",
      path: `${base}/updates/${release.slug}`,
      frameAncestors: "'none'",
      xFrameOptions: "SAMEORIGIN",
      displayCapture: false,
      // The player itself is consent-gated and is rendered after hydration, so
      // the served document carries the placeholder. The policy must already
      // allow the embed origin for when the visitor allows embeds.
      contains: "YouTube video",
      frameSrcMustAllow: "https://www.youtube-nocookie.com",
    },
    {
      name: "public submission form",
      path: `${base}/${board.slug}/submit`,
      frameAncestors: "'none'",
      xFrameOptions: "SAMEORIGIN",
      displayCapture: true,
    },
    {
      name: "widget frame",
      path: `${base}/embed?${frame.toString()}`,
      frameAncestors: `'self' ${hostOrigin}`,
      xFrameOptions: null,
      displayCapture: true,
    },
    {
      name: "widget compose panel",
      path: `${base}/embed/feedback/${board.slug}/new?${frame.toString()}`,
      frameAncestors: `'self' ${hostOrigin}`,
      xFrameOptions: null,
      displayCapture: true,
    },
  ];
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

describe("policy audit helpers", () => {
  test("a policy is parsed into directives and sources", () => {
    const policy = parseCsp("default-src 'self'; frame-ancestors 'none'; img-src data:");
    expect(policy.get("default-src")).toEqual(["'self'"]);
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
    expect(policy.get("img-src")).toEqual(["data:"]);
  });

  test("a script outside the policy is reported", () => {
    const policy = parseCsp("default-src 'self'; script-src 'self' 'unsafe-inline'");
    expect(
      findPolicyViolations(
        '<script src="https://cdn.example.com/app.js"></script>',
        policy,
        "https://app.test",
      ),
    ).toEqual(["script-src blocks https://cdn.example.com/app.js"]);
  });

  test("inline scripts need 'unsafe-inline'", () => {
    const allowed = parseCsp("script-src 'self' 'unsafe-inline'");
    expect(findPolicyViolations("<script>boot()</script>", allowed, "https://app.test")).toEqual(
      [],
    );

    const denied = parseCsp("script-src 'self'");
    expect(findPolicyViolations("<script>boot()</script>", denied, "https://app.test")).toEqual(
      ["script-src blocks an inline script"],
    );
  });

  test("frames fall back to default-src unless frame-src names the host", () => {
    const html =
      '<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"></iframe>';

    expect(
      findPolicyViolations(
        html,
        parseCsp("frame-src https://www.youtube-nocookie.com"),
        "https://app.test",
      ),
    ).toEqual([]);
    expect(
      findPolicyViolations(html, parseCsp("default-src 'self'"), "https://app.test"),
    ).toEqual(["frame-src blocks https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"]);
  });

  test("data: images are allowed when img-src lists the scheme", () => {
    const html = '<img src="data:image/png;base64,AAAA">';
    expect(
      findPolicyViolations(html, parseCsp("img-src 'self' data:"), "https://app.test"),
    ).toEqual([]);
    expect(
      findPolicyViolations(html, parseCsp("img-src 'self'"), "https://app.test"),
    ).toEqual(["img-src blocks data:image/png;base64,AAAA"]);
  });
});

describe("served content security policy", () => {
  test(
    "every surface ships a policy that allows what it references",
    async () => {
      const failures: string[] = [];

      for (const surface of surfaces) {
        const response = await fetch(`${origin}${surface.path}`, {
          headers: surface.session ? { cookie: sessionCookie } : {},
          redirect: "follow",
          signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
        }).catch((error: unknown) => {
          failures.push(
            `${surface.name} — request failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return null;
        });
        if (!response) continue;

        if (response.status !== 200) {
          failures.push(`${surface.name} — HTTP ${response.status}`);
          continue;
        }

        const html = await response.text();

        if (!html.includes("</html>")) {
          failures.push(`${surface.name} — response did not complete`);
        }
        if (surface.contains && !html.includes(surface.contains)) {
          failures.push(`${surface.name} — document is missing ${surface.contains}`);
        }

        const enforced = response.headers.get("content-security-policy");
        const reportOnly = response.headers.get("content-security-policy-report-only");
        if (!enforced) failures.push(`${surface.name} — no enforcing policy`);
        if (!reportOnly) failures.push(`${surface.name} — no report-only policy`);
        if (!enforced || !reportOnly) continue;

        if (surface.frameSrcMustAllow) {
          const directives = parseCsp(reportOnly);
          const frameSources =
            directives.get("frame-src") ?? directives.get("default-src") ?? [];
          if (!frameSources.includes(surface.frameSrcMustAllow)) {
            failures.push(
              `${surface.name} — frame-src does not allow ${surface.frameSrcMustAllow}`,
            );
          }
        }

        const expectedAncestors = `frame-ancestors ${surface.frameAncestors}`;
        if (!enforced.includes(expectedAncestors)) {
          failures.push(
            `${surface.name} — expected "${expectedAncestors}" in ${enforced}`,
          );
        }

        const xFrameOptions = response.headers.get("x-frame-options");
        if (surface.xFrameOptions === null) {
          if (xFrameOptions !== null) {
            failures.push(
              `${surface.name} — X-Frame-Options must be omitted, got ${xFrameOptions}`,
            );
          }
        } else if (xFrameOptions !== surface.xFrameOptions) {
          failures.push(
            `${surface.name} — expected X-Frame-Options ${surface.xFrameOptions}, got ${xFrameOptions ?? "none"}`,
          );
        }

        const permissions = response.headers.get("permissions-policy") ?? "";
        for (const denied of ["camera=()", "microphone=()", "geolocation=()"]) {
          if (!permissions.includes(denied)) {
            failures.push(`${surface.name} — Permissions-Policy is missing ${denied}`);
          }
        }
        const expectedCapture = surface.displayCapture
          ? "display-capture=(self)"
          : "display-capture=()";
        if (!permissions.includes(expectedCapture)) {
          failures.push(
            `${surface.name} — expected ${expectedCapture} in ${permissions || "no Permissions-Policy"}`,
          );
        }

        for (const violation of findPolicyViolations(
          html,
          parseCsp(reportOnly),
          origin,
        )) {
          failures.push(`${surface.name} — ${violation}`);
        }
      }

      expect(failures).toEqual([]);
    },
    SUITE_TIMEOUT_MS,
  );
});
