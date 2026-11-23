/**
 * Deterministic fixtures for the Playwright suite.
 *
 * Everything the flows depend on is created here, at fixed slugs, so a spec
 * never invents a workspace or scrapes an id out of the UI. The password is
 * hashed with Better Auth's own `hashPassword`, so sign-in in the browser is
 * the real credential flow rather than a forged session row.
 *
 * Run against the disposable e2e database:
 *   DATABASE_URL=postgres://…/herald_e2e bun --conditions=react-server scripts/e2e/seed.ts
 */
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { account, user } from "@/db/schema/auth";

import {
  createBoard,
  createConversation,
  createConversationMessage,
  createCustomer,
  createFeedbackPost,
  createMember,
  createProduct,
  createWorkspace,
} from "../../tests/integration/factories";

export const E2E_WORKSPACE_SLUG = "herald-e2e";
export const E2E_PRODUCT_SLUG = "herald";
export const E2E_BOARD_SLUG = "feedback";
export const E2E_EMAIL = "e2e@herald.test";
export const E2E_PASSWORD = "herald-e2e-password";

async function main(): Promise<void> {
  const workspace = await createWorkspace({
    slug: E2E_WORKSPACE_SLUG,
    name: "Herald E2E",
    plan: "pro",
  });
  const product = await createProduct(workspace.id, {
    slug: E2E_PRODUCT_SLUG,
    name: "Herald",
    description: "Changelogs and customer feedback, in one place.",
    publicFeedbackEnabled: true,
    publicRoadmapEnabled: true,
    publicChangelogEnabled: true,
  });
  const board = await createBoard(product.id, {
    slug: E2E_BOARD_SLUG,
    name: "Feedback",
    visibility: "public",
    guestPosting: true,
    settings: {
      moderation: {
        requireApproval: "none",
        comments: "open",
        blockSensitiveInfo: false,
      },
    },
  });

  await createFeedbackPost({
    productId: product.id,
    boardId: board.id,
    title: "Export every request as a CSV",
    body: "Our support team wants one download with every request, vote count and customer.",
    authorLabel: "Priya · Northwind",
  });
  await createFeedbackPost({
    productId: product.id,
    boardId: board.id,
    title: "Dark mode for the dashboard",
    body: "The dashboard is bright enough that late-night triage is uncomfortable.",
    authorLabel: "Sam · Acme",
  });

  const customer = await createCustomer(workspace.id, {
    name: "Ada Lovelace",
    email: "ada@example.test",
    verifiedAt: new Date("2026-11-01T09:00:00.000Z"),
  });
  const conversation = await createConversation({
    workspaceId: workspace.id,
    productId: product.id,
    customerId: customer.id,
    subject: "Exported CSV has stale rows",
    status: "queue",
    unreadForTeam: 1,
    lastMessageAt: new Date("2026-11-20T10:00:00.000Z"),
  });
  await createConversationMessage({
    conversation,
    authorType: "customer",
    body: "The CSV still shows a request I archived yesterday. Can you check the export window?",
    createdAt: new Date("2026-11-20T10:00:00.000Z"),
  });

  const owner = await createMember(workspace.id, { role: "owner" });
  await db
    .update(user)
    .set({ email: E2E_EMAIL, emailVerified: true, name: "E2E Owner" })
    .where(eq(user.id, owner.user.id));
  await db.insert(account).values({
    id: "acc_e2e_owner",
    accountId: owner.user.id,
    providerId: "credential",
    userId: owner.user.id,
    password: await hashPassword(E2E_PASSWORD),
  });

  console.log(
    JSON.stringify(
      {
        workspace: workspace.slug,
        product: product.slug,
        board: board.slug,
        email: E2E_EMAIL,
        conversationId: conversation.id,
      },
      null,
      2,
    ),
  );
}

await main();
