import { afterAll, beforeAll, describe, expect } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { products } from "@/db/schema";
import { workspaceEmailIdentities } from "@/db/schema/email";
import { startCheckout } from "@/features/billing/service";
import { saveSenderIdentity } from "@/features/email/identity";
import { isWorkspaceSetupComplete } from "@/features/overview/setup";
import { saveWidgetSettings } from "@/features/widget/settings";

import {
  createMember,
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

const BILLING_ENV = {
  STRIPE_SECRET_KEY: "sk_test_setup",
  STRIPE_WEBHOOK_SECRET: "whsec_setup",
  STRIPE_PRICE_STARTER: "price_starter_setup",
  STRIPE_PRICE_PRO: "price_pro_setup",
} as const;

let previous: Record<string, string | undefined> = {};

beforeAll(async () => {
  previous = Object.fromEntries(
    Object.keys(BILLING_ENV).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, BILLING_ENV);
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function completeSetup(workspaceId: string): Promise<void> {
  const product = await createProduct(workspaceId, {
    description: "A complete product description for the setup checklist.",
  });
  await createRelease({ productId: product.id, status: "published" });
  await saveWidgetSettings({
    workspaceId,
    allowedOrigins: ["https://example.test"],
    position: "bottom-right",
    theme: "light",
    sections: ["feedback"],
    originOverrides: [],
  });
  const { user } = await createMember(workspaceId);
  await saveSenderIdentity({
    workspaceId,
    actorUserId: user.id,
    fromName: "Acme Support",
    fromEmail: "support@example.test",
    replyTo: null,
    postalAddress: "123 Test Street, Test City",
  });
  // A saved sender is not a ready sender: the checklist requires a verified
  // address, because campaign email may only go out from one.
  await db
    .update(workspaceEmailIdentities)
    .set({ fromVerifiedAt: new Date(), replyToVerifiedAt: new Date() })
    .where(eq(workspaceEmailIdentities.workspaceId, workspaceId));
  await createMember(workspaceId);
}

async function checkoutTrialDays(workspace: {
  id: string;
  slug: string;
  name: string;
}): Promise<string | null> {
  let captured: string | null = null;
  const originalFetch = globalThis.fetch;

  const mockFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/v1/customers")) {
      return json({ id: `cus_${uniqueLabel("setup")}` });
    }
    if (url.endsWith("/v1/checkout/sessions")) {
      const body = new URLSearchParams(String(init?.body ?? ""));
      captured = body.get("subscription_data[trial_period_days]");
      return json({ id: "cs_setup", url: "https://checkout.stripe.test/session" });
    }
    throw new Error(`Unexpected Stripe request: ${url}`);
  };

  globalThis.fetch = mockFetch as unknown as typeof fetch;
  try {
    const result = await startCheckout({
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
      email: "owner@example.test",
      plan: "starter",
    });
    expect(result).toEqual({ ok: true, url: "https://checkout.stripe.test/session" });
  } finally {
    globalThis.fetch = originalFetch;
  }

  return captured;
}

describe("setup completion offer", () => {
  isolatedTest("requires every setup fact before it completes", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);

    expect(await isWorkspaceSetupComplete(workspace.id)).toBe(false);

    await db
      .update(products)
      .set({ description: "A complete product description." })
      .where(eq(products.id, product.id));
    expect(await isWorkspaceSetupComplete(workspace.id)).toBe(false);

    await createRelease({ productId: product.id, status: "draft" });
    expect(await isWorkspaceSetupComplete(workspace.id)).toBe(false);

    await createRelease({ productId: product.id, status: "published" });
    expect(await isWorkspaceSetupComplete(workspace.id)).toBe(false);

    await saveWidgetSettings({
      workspaceId: workspace.id,
      allowedOrigins: ["https://example.test"],
      position: "bottom-right",
      theme: "light",
      sections: ["feedback"],
      originOverrides: [],
    });
    expect(await isWorkspaceSetupComplete(workspace.id)).toBe(false);

    const { user } = await createMember(workspace.id);
    await saveSenderIdentity({
      workspaceId: workspace.id,
      actorUserId: user.id,
      fromName: "Acme Support",
      fromEmail: "support@example.test",
      replyTo: null,
      postalAddress: "123 Test Street, Test City",
    });
    expect(await isWorkspaceSetupComplete(workspace.id)).toBe(false);

    await db
      .update(workspaceEmailIdentities)
      .set({ fromVerifiedAt: new Date(), replyToVerifiedAt: new Date() })
      .where(eq(workspaceEmailIdentities.workspaceId, workspace.id));
    expect(await isWorkspaceSetupComplete(workspace.id)).toBe(false);

    await createMember(workspace.id);
    expect(await isWorkspaceSetupComplete(workspace.id)).toBe(true);
  });

  isolatedTest("keeps the base trial before setup is complete", async () => {
    const workspace = await createWorkspace();
    expect(await checkoutTrialDays(workspace)).toBe("14");
  });

  isolatedTest("starts a 30-day trial after setup is complete", async () => {
    const workspace = await createWorkspace();
    await completeSetup(workspace.id);
    expect(await checkoutTrialDays(workspace)).toBe("30");
  });
});
