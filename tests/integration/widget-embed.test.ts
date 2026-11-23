import { afterAll, beforeAll, describe, expect } from "bun:test";

import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";

import { GET as readSession } from "@/app/api/public/session/route";
import { GET as readUnread } from "@/app/api/public/notifications/unread/route";
import { POST as identifyWidget } from "@/app/api/widget/identify/route";
import { db } from "@/db";
import {
  customerCompanies,
  customerCompanyMemberships,
  customers,
} from "@/db/schema";
import { inAppNotifications } from "@/db/schema/notifications";
import { saveIdentitySettings } from "@/features/customer-auth/identity-settings";
import { getServerEnv } from "@/lib/env";
import { signHs256Jwt } from "@/features/customer-auth/jwt";
import { createCustomerSession } from "@/features/customer-session/session";
import { publicUnreadNotificationCount } from "@/features/notifications/inbox";
import {
  ensureWidgetSettings,
  readWidgetSettings,
  saveWidgetSettings,
} from "@/features/widget/settings";
import {
  loadWidgetShell,
  resolveWidgetTenant,
  widgetBoardSlug,
} from "@/features/widget/service";

import {
  createBoard,
  createCustomer,
  createProduct,
  createRelease,
  createWorkspace,
  uniqueLabel,
} from "./factories";
import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";

/**
 * Widget tenant shell contract.
 *
 * The iframe panels reuse the public projections, so this suite focuses on the
 * widget-specific gate: a product needs a public surface, the widget plan
 * feature and the deployment flag. The board link doubles as the feedback
 * panel's default and must be the same public board the site resolves.
 */

let previousFlag: string | undefined;
let previousUrl: string | undefined;
let previousSecret: string | undefined;
let origin: string;

beforeAll(async () => {
  previousFlag = process.env.FLAG_WIDGET;
  previousUrl = process.env.BETTER_AUTH_URL;
  previousSecret = process.env.BETTER_AUTH_SECRET;

  process.env.FLAG_WIDGET = "on";
  process.env.BETTER_AUTH_URL ??= "http://app.local";
  process.env.BETTER_AUTH_SECRET ??= "integration-secret-value-at-least-32-chars";

  await setupTestDatabase();
  // Read the same cached value the route's origin check uses: another suite in
  // this process may have restored process.env after the first validation.
  origin = new URL(getServerEnv().BETTER_AUTH_URL).origin;
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  if (previousFlag === undefined) delete process.env.FLAG_WIDGET;
  else process.env.FLAG_WIDGET = previousFlag;
  if (previousUrl === undefined) delete process.env.BETTER_AUTH_URL;
  else process.env.BETTER_AUTH_URL = previousUrl;
  if (previousSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = previousSecret;
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

function sessionCookie(response: Response): string {
  const raw = response.headers
    .getSetCookie()
    .find((value) => value.startsWith("herald_customer_session="));
  if (!raw) throw new Error("The identity response did not set a session cookie.");
  return raw.split(";")[0] ?? "";
}

function identifyRequest(workspaceSlug: string, token: string): NextRequest {
  return new NextRequest("http://app.local/api/widget/identify", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ workspaceSlug, token }),
  });
}

describe("widget embed", () => {
  isolatedTest("resolves panels and the default public board", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id, {
      publicFeedbackEnabled: true,
      publicRoadmapEnabled: true,
      publicChangelogEnabled: true,
    });
    const board = await createBoard(product.id, { slug: "requests", position: 0 });
    await createBoard(product.id, { slug: "ideas", position: 1 });
    await createRelease({
      productId: product.id,
      title: "Visible update",
      status: "published",
    });

    const tenant = await resolveWidgetTenant({
      workspaceSlug: workspace.slug,
      productSlug: product.slug,
    });
    expect(tenant?.workspace.slug).toBe(workspace.slug);
    expect(tenant?.product.slug).toBe(product.slug);
    expect(tenant?.boardSlug).toBe(board.slug);

    const shell = await loadWidgetShell({
      workspaceSlug: workspace.slug,
      productSlug: product.slug,
      viewer: null,
    });
    expect(shell).not.toBeNull();
    if (!shell) return;

    expect(shell.panels).toEqual({
      help: true,
      feedback: true,
      roadmap: true,
      updates: true,
      messages: true,
      notifications: true,
    });
    expect(shell.unread).toBe(0);
    expect(shell.presence.online).toBe(false);
    expect(await widgetBoardSlug(shell, "ideas")).toBe("ideas");
    expect(await widgetBoardSlug(shell, "private")).toBeNull();
  });

  isolatedTest("settings issue a stable key and gate key plus origin", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id, {
      publicFeedbackEnabled: true,
    });
    await createBoard(product.id, { slug: "requests" });

    const first = await ensureWidgetSettings(workspace.id);
    expect(first.publicKey.startsWith("hpk_")).toBe(true);
    expect(first.allowedOrigins).toEqual([]);
    expect(first.position).toBe("bottom-right");
    expect(first.theme).toBe("auto");
    expect(first.sections).toEqual(["feedback", "roadmap"]);

    const second = await ensureWidgetSettings(workspace.id);
    expect(second.publicKey).toBe(first.publicKey);

    const saved = await saveWidgetSettings({
      workspaceId: workspace.id,
      allowedOrigins: ["https://app.example.test"],
      position: "top-left",
      theme: "dark",
      sections: ["feedback", "roadmap", "messages"],
      originOverrides: [],
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.settings).toMatchObject({
      publicKey: first.publicKey,
      allowedOrigins: ["https://app.example.test"],
      position: "top-left",
      theme: "dark",
      sections: ["feedback", "roadmap", "messages"],
    });

    const base = { workspaceSlug: workspace.slug, productSlug: product.slug };
    expect(
      await loadWidgetShell({ ...base, projectKey: null, hostOrigin: "https://app.example.test" }),
    ).toBeNull();
    expect(
      await loadWidgetShell({
        ...base,
        projectKey: first.publicKey,
        hostOrigin: "https://evil.example.test",
      }),
    ).toBeNull();

    const allowed = await loadWidgetShell({
      ...base,
      projectKey: first.publicKey,
      hostOrigin: "https://app.example.test",
      viewer: null,
    });
    expect(allowed).not.toBeNull();

    expect(await readWidgetSettings(workspace.id)).toMatchObject({
      publicKey: first.publicKey,
      allowedOrigins: ["https://app.example.test"],
      position: "top-left",
      theme: "dark",
      sections: ["feedback", "roadmap", "messages"],
      originOverrides: [],
    });
  });

  isolatedTest("an empty allowlist still requires the key once configured", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id, {
      publicFeedbackEnabled: true,
    });
    await createBoard(product.id, { slug: "requests" });

    const settings = await ensureWidgetSettings(workspace.id);
    const base = { workspaceSlug: workspace.slug, productSlug: product.slug };

    expect(
      await loadWidgetShell({
        ...base,
        projectKey: null,
        hostOrigin: "https://anywhere.example",
      }),
    ).toBeNull();
    expect(
      await loadWidgetShell({
        ...base,
        projectKey: settings.publicKey,
        hostOrigin: "https://anywhere.example",
        viewer: null,
      }),
    ).not.toBeNull();
  });

  isolatedTest("the unread endpoint reflects a publish or reply without a reload", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id, {
      publicFeedbackEnabled: true,
    });
    await createBoard(product.id, { slug: "requests" });

    const customer = await createCustomer(workspace.id, {
      email: `${uniqueLabel("widget-unread")}@example.test`,
      verifiedAt: new Date(),
    });
    const session = await createCustomerSession({
      workspaceId: workspace.id,
      customerId: customer.id,
    });
    if (!session) throw new Error("Could not create an identified session.");

    const unreadRequest = (input: {
      workspaceSlug: string;
      productSlug: string;
      cookie?: string;
    }) => {
      const query = new URLSearchParams({
        workspaceSlug: input.workspaceSlug,
        productSlug: input.productSlug,
      });
      return new NextRequest(
        `http://app.local/api/public/notifications/unread?${query.toString()}`,
        {
          headers: input.cookie
            ? { cookie: `herald_customer_session=${input.cookie}` }
            : {},
        },
      );
    };

    const empty = await readUnread(
      unreadRequest({
        workspaceSlug: workspace.slug,
        productSlug: product.slug,
        cookie: session.cookieValue,
      }),
    );
    expect(empty.status).toBe(200);
    expect(empty.headers.get("cache-control")).toBe("no-store");
    expect(await empty.json()).toEqual({ unread: 0 });

    // The two rows a changelog publish and a reply would leave behind.
    await db.insert(inAppNotifications).values([
      {
        workspaceId: workspace.id,
        productId: product.id,
        customerId: customer.id,
        kind: "release_published",
        title: "New update: Faster search",
        body: "A new update is available.",
        href: `/p/${workspace.slug}/${product.slug}/updates/faster-search`,
        dedupeKey: `test:widget-unread:release:${customer.id}`,
      },
      {
        workspaceId: workspace.id,
        productId: product.id,
        customerId: customer.id,
        kind: "feedback_reply",
        title: "New reply",
        body: "A reply from the team.",
        href: `/p/${workspace.slug}/${product.slug}/requests/${customer.id}`,
        dedupeKey: `test:widget-unread:reply:${customer.id}`,
      },
    ]);

    // The session and rows resolve outside the route too, so a zero below is
    // the route's problem rather than missing fixture data.
    expect(
      await publicUnreadNotificationCount({
        workspaceSlug: workspace.slug,
        productSlug: product.slug,
        sessionCookie: session.cookieValue,
      }),
    ).toBe(2);

    const updated = await readUnread(
      unreadRequest({
        workspaceSlug: workspace.slug,
        productSlug: product.slug,
        cookie: session.cookieValue,
      }),
    );
    expect(await updated.json()).toEqual({ unread: 2 });

    // Signed out and cross-workspace polls stay at zero; the count is never
    // resolved from the query string.
    expect(
      await (
        await readUnread(
          unreadRequest({
            workspaceSlug: workspace.slug,
            productSlug: product.slug,
          }),
        )
      ).json(),
    ).toEqual({ unread: 0 });

    const otherWorkspace = await createWorkspace();
    expect(
      await (
        await readUnread(
          unreadRequest({
            workspaceSlug: otherWorkspace.slug,
            productSlug: product.slug,
            cookie: session.cookieValue,
          }),
        )
      ).json(),
    ).toEqual({ unread: 0 });

    expect(
      (
        await readUnread(
          unreadRequest({ workspaceSlug: "..", productSlug: product.slug }),
        )
      ).status,
    ).toBe(400);
  });

  isolatedTest("a product with no public surface cannot be embedded", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id, {
      publicFeedbackEnabled: false,
      publicRoadmapEnabled: false,
      publicChangelogEnabled: false,
    });

    expect(
      await resolveWidgetTenant({
        workspaceSlug: workspace.slug,
        productSlug: product.slug,
      }),
    ).toBeNull();
  });

  isolatedTest("signed identity sets a public session without duplicating the customer", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const product = await createProduct(workspace.id, {
      publicFeedbackEnabled: true,
    });
    await createBoard(product.id, { slug: "requests" });

    const saved = await saveIdentitySettings({
      workspaceId: workspace.id,
      enabled: true,
      issuer: "herald",
      audience: workspace.slug,
      requireSignedTokens: true,
    });
    if (!saved.generatedSecret) throw new Error("SSO did not generate a secret.");

    const token = signHs256Jwt({
      secret: saved.generatedSecret,
      subject: "crm-42",
      issuer: "herald",
      audience: workspace.slug,
      claims: {
        email: "ada@example.test",
        firstName: "Ada",
        lastName: "Lovelace",
        companies: [
          {
            id: "acme",
            name: "Acme",
            domain: "https://www.acme.example",
            role: "owner",
            traits: { plan: "enterprise" },
          },
        ],
      },
    });

    const first = await identifyWidget(identifyRequest(workspace.slug, token));
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("no-store");
    const cookie = sessionCookie(first);

    // The public session route is the same principal the public pages read.
    const publicSession = await readSession(
      new NextRequest("http://app.local/api/public/session", {
        headers: { cookie },
      }),
    );
    const body = (await publicSession.json()) as {
      session: {
        workspaceId: string;
        guest: boolean;
        customer: { email: string | null; verified: boolean };
      } | null;
    };
    expect(body.session?.workspaceId).toBe(workspace.id);
    expect(body.session?.guest).toBe(false);
    expect(body.session?.customer).toMatchObject({
      email: "ada@example.test",
      verified: true,
    });

    const second = await identifyWidget(identifyRequest(workspace.slug, token));
    expect(second.status).toBe(200);
    expect(sessionCookie(second)).not.toBe(cookie);

    const allCustomers = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.workspaceId, workspace.id));
    expect(allCustomers).toHaveLength(1);

    const companies = await db
      .select()
      .from(customerCompanies)
      .where(eq(customerCompanies.workspaceId, workspace.id));
    expect(companies).toHaveLength(1);
    expect(companies[0]).toMatchObject({
      externalId: "acme",
      name: "Acme",
      domainNormalized: "acme.example",
      traits: { plan: "enterprise" },
    });

    const memberships = await db
      .select()
      .from(customerCompanyMemberships)
      .where(eq(customerCompanyMemberships.workspaceId, workspace.id));
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({
      customerId: allCustomers[0]?.id,
      companyId: companies[0]?.id,
      role: "owner",
    });
  });

  isolatedTest("a rejected identity sets no session", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const product = await createProduct(workspace.id, {
      publicFeedbackEnabled: true,
    });
    await createBoard(product.id, { slug: "requests" });

    // With SSO enabled, a malformed token is an invalid credential (401).
    // Without it, the same request is refused as disabled (403).
    await saveIdentitySettings({
      workspaceId: workspace.id,
      enabled: true,
      issuer: "herald",
      audience: workspace.slug,
      requireSignedTokens: true,
    });

    const response = await identifyWidget(
      identifyRequest(workspace.slug, "not-a-token"),
    );
    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie()).toHaveLength(0);
  });

  isolatedTest("widget identify is rate limited per client", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id, {
      publicFeedbackEnabled: true,
    });
    await createBoard(product.id, { slug: "requests" });

    const request = () => {
      const next = identifyRequest(workspace.slug, "not-a-token");
      next.headers.set("x-forwarded-for", "203.0.113.90");
      return next;
    };

    for (let attempt = 0; attempt < 30; attempt += 1) {
      // SSO is disabled here, so the credential is rejected as forbidden
      // rather than invalid; either way the request stays below the limit.
      expect([401, 403]).toContain((await identifyWidget(request())).status);
    }
    expect((await identifyWidget(request())).status).toBe(429);
  });

  isolatedTest("the deployment flag closes the embed even when the product is public", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id, {
      publicFeedbackEnabled: true,
      publicChangelogEnabled: true,
    });

    process.env.FLAG_WIDGET = "off";
    try {
      expect(
        await resolveWidgetTenant({
          workspaceSlug: workspace.slug,
          productSlug: product.slug,
        }),
      ).toBeNull();
    } finally {
      process.env.FLAG_WIDGET = "on";
    }
  });
});
