import { afterAll, beforeAll, describe, expect } from "bun:test";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  customerLoginTokens,
  customers,
  customerSessions,
  feedbackCustomerVotes,
  feedbackPosts,
  workspaceIdentitySettings,
  workspaces,
} from "@/db/schema";
import {
  completeIdentitySecretRotation,
  getIdentitySettings,
  saveIdentitySettings,
  rotateIdentitySecret,
} from "@/features/customer-auth/identity-settings";
import { signHs256Jwt } from "@/features/customer-auth/jwt";
import { consumeMagicLink, requestMagicLink } from "@/features/customer-auth/magic-link";
import { identifyWithSso } from "@/features/customer-auth/sso";
import {
  createGuestCustomerSession,
  revokeCustomerSession,
} from "@/features/customer-session/session";

import {
  createBoard,
  createCustomer,
  createFeedbackPost,
  createProduct,
  createWorkspace,
} from "./factories";
import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";

/**
 * Customer authentication through the real services, database and email
 * adapter. The provider is a local HTTP server; the magic-link token is read
 * from the message it receives, so nothing is mocked inside the application.
 */

type EmailMessage = {
  to: string[];
  subject: string;
  text: string;
  html: string;
};

let server: ReturnType<typeof Bun.serve> | null = null;
const emails: EmailMessage[] = [];

let previous: Record<string, string | undefined> = {};
const origin = "http://app.local";

const ISSUER = "herald";

beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as EmailMessage;
      emails.push(body);
      return Response.json({ id: `msg_${emails.length}` });
    },
  });

  previous = {
    FLAG_PUBLIC_FEEDBACK: process.env.FLAG_PUBLIC_FEEDBACK,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    EMAIL_API_URL: process.env.EMAIL_API_URL,
    OCR_API_URL: process.env.OCR_API_URL,
    OCR_API_KEY: process.env.OCR_API_KEY,
  };

  process.env.FLAG_PUBLIC_FEEDBACK = "on";
  process.env.BETTER_AUTH_URL = origin;
  process.env.BETTER_AUTH_SECRET ??= "integration-secret-value-at-least-32-chars";
  process.env.RESEND_API_KEY = "re_integration_local_key";
  process.env.EMAIL_FROM = "Herald <updates@example.test>";
  process.env.EMAIL_API_URL = `http://127.0.0.1:${server.port}/emails`;
  delete process.env.OCR_API_URL;
  delete process.env.OCR_API_KEY;

  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  await teardownTestDatabase();
  server?.stop(true);
  server = null;
}, SETUP_TIMEOUT_MS);

async function tenant() {
  const workspace = await createWorkspace();
  const product = await createProduct(workspace.id);
  const board = await createBoard(product.id, {
    slug: "feedback",
    name: "Feedback",
    guestPosting: true,
  });
  return { workspace, product, board };
}

function tokenFromLastEmail(): string {
  const message = emails.at(-1);
  if (!message) throw new Error("No email was sent.");
  const match = /verify\?token=([A-Za-z0-9_-]+)/.exec(message.text);
  if (!match?.[1]) throw new Error("The email did not contain a sign-in link.");
  return match[1];
}

describe("magic link", () => {
  isolatedTest("upgrades the guest session instead of creating a second customer", async () => {
    const t = await tenant();
    const guest = await createGuestCustomerSession(t.workspace.id);
    emails.length = 0;

    const requested = await requestMagicLink({
      workspace: { id: t.workspace.id, name: t.workspace.name, slug: t.workspace.slug },
      productName: t.product.name,
      email: "Ada@Example.test",
      nextPath: `/p/${t.workspace.slug}/${t.product.slug}/${t.board.slug}`,
    });
    expect(requested.ok).toBe(true);
    expect(emails).toHaveLength(1);
    expect(emails[0]?.to).toEqual(["Ada@Example.test"]);
    expect(emails[0]?.text).toContain("expires in 15 minutes");

    const token = tokenFromLastEmail();
    const consumed = await consumeMagicLink({
      token,
      activeSession: guest.active,
    });

    expect(consumed.ok).toBe(true);
    if (!consumed.ok) return;
    expect(consumed.customerId).toBe(guest.active.customer.id);
    expect(consumed.nextPath).toBe(
      `/p/${t.workspace.slug}/${t.product.slug}/${t.board.slug}`,
    );

    const customer = await db
      .select()
      .from(customers)
      .where(eq(customers.id, guest.active.customer.id));
    expect(customer[0]?.emailNormalized).toBe("ada@example.test");
    expect(customer[0]?.verifiedAt).not.toBeNull();

    const sessions = await db
      .select({ guest: customerSessions.guest })
      .from(customerSessions)
      .where(eq(customerSessions.customerId, guest.active.customer.id));
    expect(sessions).toEqual([{ guest: false }]);

    const replay = await consumeMagicLink({
      token,
      activeSession: null,
    });
    expect(replay).toEqual({ ok: false, reason: "invalid" });
  });

  isolatedTest("moves a guest's posts and votes onto the signed-in customer", async () => {
    const t = await tenant();
    const target = await createCustomer(t.workspace.id, {
      email: "grace@example.test",
      verifiedAt: new Date(),
    });
    const guest = await createGuestCustomerSession(t.workspace.id);

    const post = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
      authorCustomerId: guest.active.customer.id,
      title: "Guest history",
    });
    const otherPost = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
      title: "Another request",
    });
    await db.insert(feedbackCustomerVotes).values({
      feedbackPostId: otherPost.id,
      customerId: guest.active.customer.id,
    });

    emails.length = 0;
    await requestMagicLink({
      workspace: { id: t.workspace.id, name: t.workspace.name, slug: t.workspace.slug },
      productName: t.product.name,
      email: "grace@example.test",
      nextPath: null,
    });

    const consumed = await consumeMagicLink({
      token: tokenFromLastEmail(),
      activeSession: guest.active,
    });
    expect(consumed.ok).toBe(true);
    if (!consumed.ok) return;
    expect(consumed.customerId).toBe(target.id);

    const movedPost = await db
      .select({ authorCustomerId: feedbackPosts.authorCustomerId })
      .from(feedbackPosts)
      .where(eq(feedbackPosts.id, post.id));
    expect(movedPost[0]?.authorCustomerId).toBe(target.id);

    const votes = await db
      .select({ customerId: feedbackCustomerVotes.customerId })
      .from(feedbackCustomerVotes)
      .where(eq(feedbackCustomerVotes.feedbackPostId, otherPost.id));
    expect(votes).toEqual([{ customerId: target.id }]);

    const guestRows = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.id, guest.active.customer.id));
    expect(guestRows).toHaveLength(0);
  });

  isolatedTest("does not sign in a banned customer", async () => {
    const t = await tenant();
    await createCustomer(t.workspace.id, {
      email: "banned@example.test",
      verifiedAt: new Date(),
      bannedAt: new Date(),
    });

    emails.length = 0;
    await requestMagicLink({
      workspace: { id: t.workspace.id, name: t.workspace.name, slug: t.workspace.slug },
      productName: t.product.name,
      email: "banned@example.test",
      nextPath: null,
    });

    const consumed = await consumeMagicLink({
      token: tokenFromLastEmail(),
      activeSession: null,
    });
    expect(consumed).toEqual({ ok: false, reason: "banned" });
  });

  isolatedTest("expires unused tokens and invalidates sibling links", async () => {
    const t = await tenant();
    emails.length = 0;
    await requestMagicLink({
      workspace: { id: t.workspace.id, name: t.workspace.name, slug: t.workspace.slug },
      productName: t.product.name,
      email: "first@example.test",
      nextPath: null,
    });
    const first = tokenFromLastEmail();

    await requestMagicLink({
      workspace: { id: t.workspace.id, name: t.workspace.name, slug: t.workspace.slug },
      productName: t.product.name,
      email: "first@example.test",
      nextPath: null,
    });
    const second = tokenFromLastEmail();

    const consumed = await consumeMagicLink({
      token: second,
      activeSession: null,
    });
    expect(consumed.ok).toBe(true);

    const stale = await consumeMagicLink({ token: first, activeSession: null });
    expect(stale).toEqual({ ok: false, reason: "invalid" });

    const outstanding = await db
      .select({ usedAt: customerLoginTokens.usedAt })
      .from(customerLoginTokens)
      .where(
        and(
          eq(customerLoginTokens.workspaceId, t.workspace.id),
          eq(customerLoginTokens.emailNormalized, "first@example.test"),
        ),
      );
    expect(outstanding.every((row) => row.usedAt !== null)).toBe(true);
  });
});

describe("signed identity", () => {
  async function ssoTenant() {
    const t = await tenant();
    await db.update(workspaces).set({ plan: "pro" }).where(eq(workspaces.id, t.workspace.id));
    const saved = await saveIdentitySettings({
      workspaceId: t.workspace.id,
      enabled: true,
      issuer: ISSUER,
      audience: t.workspace.slug,
      requireSignedTokens: true,
    });
    if (!saved.generatedSecret) throw new Error("SSO did not generate a secret.");
    return { ...t, secret: saved.generatedSecret };
  }

  isolatedTest("creates a verified customer and is idempotent by subject", async () => {
    const t = await ssoTenant();
    const token = signHs256Jwt({
      secret: t.secret,
      subject: "crm-42",
      issuer: ISSUER,
      audience: t.workspace.slug,
      claims: {
        email: "ada@example.test",
        name: "Ada Lovelace",
        traits: { plan: "pro", seats: 4 },
      },
    });

    const first = await identifyWithSso({
      workspace: { id: t.workspace.id, slug: t.workspace.slug },
      token,
      activeSession: null,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.session.guest).toBe(false);
    expect(first.session.customer.email).toBe("ada@example.test");

    const customer = await db
      .select()
      .from(customers)
      .where(eq(customers.id, first.customerId));
    expect(customer[0]?.externalId).toBe("crm-42");
    expect(customer[0]?.verifiedAt).not.toBeNull();
    expect(customer[0]?.traits).toEqual({ plan: "pro", seats: 4 });

    const secondToken = signHs256Jwt({
      secret: t.secret,
      subject: "crm-42",
      issuer: ISSUER,
      audience: t.workspace.slug,
      claims: { email: "ada@example.test", name: "Ada L." },
    });
    const second = await identifyWithSso({
      workspace: { id: t.workspace.id, slug: t.workspace.slug },
      token: secondToken,
      activeSession: null,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.customerId).toBe(first.customerId);

    const all = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.workspaceId, t.workspace.id));
    expect(all).toHaveLength(1);
  });

  isolatedTest("merges an existing guest into the signed identity", async () => {
    const t = await ssoTenant();
    const guest = await createGuestCustomerSession(t.workspace.id);
    const post = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
      authorCustomerId: guest.active.customer.id,
      title: "Guest request",
    });

    const token = signHs256Jwt({
      secret: t.secret,
      subject: "crm-7",
      issuer: ISSUER,
      audience: t.workspace.slug,
      claims: { email: "grace@example.test", name: "Grace" },
    });

    const result = await identifyWithSso({
      workspace: { id: t.workspace.id, slug: t.workspace.slug },
      token,
      activeSession: guest.active,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const moved = await db
      .select({ authorCustomerId: feedbackPosts.authorCustomerId })
      .from(feedbackPosts)
      .where(eq(feedbackPosts.id, post.id));
    expect(moved[0]?.authorCustomerId).toBe(result.customerId);

    const guestRows = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.id, guest.active.customer.id));
    expect(guestRows).toHaveLength(0);
  });

  isolatedTest("fails closed for a wrong secret, expiry and disabled SSO", async () => {
    const t = await ssoTenant();

    const wrongSecret = signHs256Jwt({
      secret: "not-the-workspace-secret",
      subject: "crm-1",
      issuer: ISSUER,
      audience: t.workspace.slug,
    });
    expect(
      await identifyWithSso({
        workspace: { id: t.workspace.id, slug: t.workspace.slug },
        token: wrongSecret,
        activeSession: null,
      }),
    ).toEqual({ ok: false, reason: "invalid" });

    const expired = signHs256Jwt({
      secret: t.secret,
      subject: "crm-1",
      issuer: ISSUER,
      audience: t.workspace.slug,
      issuedAt: Math.floor(Date.now() / 1000) - 7200,
      lifetimeSeconds: 60,
    });
    expect(
      await identifyWithSso({
        workspace: { id: t.workspace.id, slug: t.workspace.slug },
        token: expired,
        activeSession: null,
      }),
    ).toEqual({ ok: false, reason: "invalid" });

    await saveIdentitySettings({
      workspaceId: t.workspace.id,
      enabled: false,
      issuer: ISSUER,
      audience: t.workspace.slug,
      requireSignedTokens: true,
    });

    const valid = signHs256Jwt({
      secret: t.secret,
      subject: "crm-1",
      issuer: ISSUER,
      audience: t.workspace.slug,
    });
    expect(
      await identifyWithSso({
        workspace: { id: t.workspace.id, slug: t.workspace.slug },
        token: valid,
        activeSession: null,
      }),
    ).toEqual({ ok: false, reason: "disabled" });
  });

  isolatedTest("rotation keeps the previous secret valid until the overlap ends", async () => {
    const t = await ssoTenant();
    const oldToken = signHs256Jwt({
      secret: t.secret,
      subject: "crm-9",
      issuer: ISSUER,
      audience: t.workspace.slug,
    });

    const rotated = await rotateIdentitySecret(t.workspace.id);
    expect(rotated).not.toBe(t.secret);

    // A token minted just before the rotation still signs in, so the customer
    // can deploy the new secret without a gap.
    expect(
      await identifyWithSso({
        workspace: { id: t.workspace.id, slug: t.workspace.slug },
        token: oldToken,
        activeSession: null,
      }),
    ).toMatchObject({ ok: true });

    const fresh = signHs256Jwt({
      secret: rotated,
      subject: "crm-9",
      issuer: ISSUER,
      audience: t.workspace.slug,
    });
    expect(
      await identifyWithSso({
        workspace: { id: t.workspace.id, slug: t.workspace.slug },
        token: fresh,
        activeSession: null,
      }),
    ).toMatchObject({ ok: true });

    const pending = await getIdentitySettings(t.workspace.id, t.workspace.slug);
    expect(pending.previousSecretExpiresAt).not.toBeNull();
    expect(JSON.stringify(pending)).not.toContain(t.secret);
    expect(JSON.stringify(pending)).not.toContain(rotated);

    // Finishing early closes the overlap at once; the new secret still works.
    await completeIdentitySecretRotation(t.workspace.id);
    expect(
      await identifyWithSso({
        workspace: { id: t.workspace.id, slug: t.workspace.slug },
        token: oldToken,
        activeSession: null,
      }),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(
      await identifyWithSso({
        workspace: { id: t.workspace.id, slug: t.workspace.slug },
        token: fresh,
        activeSession: null,
      }),
    ).toMatchObject({ ok: true });
    expect(
      (await getIdentitySettings(t.workspace.id, t.workspace.slug))
        .previousSecretExpiresAt,
    ).toBeNull();
  });

  isolatedTest("an expired rotation overlap stops accepting the previous secret", async () => {
    const t = await ssoTenant();
    const oldToken = signHs256Jwt({
      secret: t.secret,
      subject: "crm-11",
      issuer: ISSUER,
      audience: t.workspace.slug,
    });

    const rotated = await rotateIdentitySecret(t.workspace.id);

    // Backdate the deadline instead of waiting out the real grace window.
    await db
      .update(workspaceIdentitySettings)
      .set({ ssoSecretPreviousExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(workspaceIdentitySettings.workspaceId, t.workspace.id));

    expect(
      await identifyWithSso({
        workspace: { id: t.workspace.id, slug: t.workspace.slug },
        token: oldToken,
        activeSession: null,
      }),
    ).toEqual({ ok: false, reason: "invalid" });

    const fresh = signHs256Jwt({
      secret: rotated,
      subject: "crm-11",
      issuer: ISSUER,
      audience: t.workspace.slug,
    });
    expect(
      await identifyWithSso({
        workspace: { id: t.workspace.id, slug: t.workspace.slug },
        token: fresh,
        activeSession: null,
      }),
    ).toMatchObject({ ok: true });
  });

  isolatedTest("settings report only whether a secret exists", async () => {
    const t = await ssoTenant();
    const settings = await getIdentitySettings(t.workspace.id, t.workspace.slug);
    expect(settings).toMatchObject({
      enabled: true,
      hasSecret: true,
      issuer: ISSUER,
      audience: t.workspace.slug,
    });
    expect(JSON.stringify(settings)).not.toContain(t.secret);
  });
});

describe("session revocation", () => {
  isolatedTest("a revoked session no longer verifies", async () => {
    const t = await tenant();
    const guest = await createGuestCustomerSession(t.workspace.id);
    await revokeCustomerSession(guest.active.session.id);

    const { findActiveCustomerSession } = await import(
      "@/features/customer-session/session"
    );
    expect(await findActiveCustomerSession(guest.cookieValue)).toBeNull();
  });
});
