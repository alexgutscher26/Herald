"use server";

import { and, asc, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { boards } from "@/db/schema/boards";
import {
  customerCompanies,
  customerCompanyMemberships,
  customers,
} from "@/db/schema/customers";
import { feedbackPosts } from "@/db/schema/feedback";
import { feedbackCustomerVotes } from "@/db/schema/feedback-extensions";
import { consumeRateLimit } from "@/features/customer-session/rate-limit";
import { recordWorkspaceAudit } from "@/features/data-controls/service";
import { authorizeProductAction } from "@/features/live/action-auth";
import type { ActionResult } from "@/features/live/action-result";
import { postPrivacySql } from "@/features/public/privacy";
import { escapeLikePattern } from "@/features/public/query";

import { isFeedbackPrivacy } from "./privacy";

/**
 * Operator actions performed as a named customer.
 *
 * The customer row is the real author or voter: `feedbackPosts.authorCustomerId`
 * and `feedbackCustomerVotes.customerId` point at it exactly as if the customer
 * had acted. The operator is recorded separately (`authorId` / `castByUserId`)
 * and in the workspace audit log, so this is attribution, not a second identity
 * or an impersonation session. Each path has its own operator rate limit.
 */

const baseSchema = z.object({
  workspaceSlug: z.string().min(1),
  productSlug: z.string().min(1),
});

const customerSchema = baseSchema.extend({
  customerId: z.uuid("Choose a customer."),
});

const submitSchema = customerSchema.extend({
  boardId: z.uuid("Choose a board."),
  title: z.string().trim().min(3, "Give the request a title.").max(140),
  body: z.string().trim().min(10, "Describe the request in a little more detail.").max(5_000),
  category: z.enum(["feature_request", "bug", "improvement", "question"]),
  privacy: z.enum(["public", "author", "company"]).default("public"),
});

const voteSchema = customerSchema.extend({
  postId: z.uuid("Choose a request."),
});

const searchSchema = baseSchema.extend({
  query: z.string().trim().max(120).default(""),
});

function revalidate(workspaceSlug: string, productSlug: string): void {
  revalidatePath(`/app/${workspaceSlug}/${productSlug}`, "layout");
}

async function findCustomer(
  workspaceId: string,
  customerId: string,
): Promise<{ id: string; name: string | null; email: string | null } | null> {
  const rows = await db
    .select({ id: customers.id, name: customers.name, email: customers.email })
    .from(customers)
    .where(
      and(
        eq(customers.id, customerId),
        eq(customers.workspaceId, workspaceId),
        isNull(customers.bannedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function hasCompany(customerId: string): Promise<boolean> {
  const rows = await db
    .select({ customerId: customerCompanyMemberships.customerId })
    .from(customerCompanyMemberships)
    .where(eq(customerCompanyMemberships.customerId, customerId))
    .limit(1);
  return rows.length > 0;
}

export type OnBehalfBoard = { id: string; name: string };

export async function listOnBehalfBoardsAction(input: {
  workspaceSlug: string;
  productSlug: string;
}): Promise<ActionResult<{ boards: OnBehalfBoard[] }>> {
  const parsed = baseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "feedback:write",
  );
  if ("error" in authorized) return authorized.error;

  const rows = await db
    .select({ id: boards.id, name: boards.name })
    .from(boards)
    .where(
      and(
        eq(boards.productId, authorized.context.product.id),
        isNull(boards.archivedAt),
      ),
    )
    .orderBy(asc(boards.position), asc(boards.name));

  return { ok: true, data: { boards: rows } };
}

export type OnBehalfCustomer = {
  id: string;
  name: string | null;
  email: string | null;
  companies: string[];
};

export async function searchOnBehalfCustomersAction(input: {
  workspaceSlug: string;
  productSlug: string;
  query?: string;
}): Promise<ActionResult<{ customers: OnBehalfCustomer[] }>> {
  const parsed = searchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid search." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "feedback:write",
  );
  if ("error" in authorized) return authorized.error;

  const pattern = `%${escapeLikePattern(parsed.data.query)}%`;
  const rows = await db
    .select({ id: customers.id, name: customers.name, email: customers.email })
    .from(customers)
    .where(
      and(
        eq(customers.workspaceId, authorized.context.workspace.id),
        isNull(customers.bannedAt),
        parsed.data.query === ""
          ? undefined
          : or(ilike(customers.name, pattern), ilike(customers.email, pattern)),
      ),
    )
    .orderBy(asc(customers.name), asc(customers.email))
    .limit(20);

  const ids = rows.map((row) => row.id);
  const memberships =
    ids.length === 0
      ? []
      : await db
          .select({
            customerId: customerCompanyMemberships.customerId,
            companyName: customerCompanies.name,
          })
          .from(customerCompanyMemberships)
          .innerJoin(
            customerCompanies,
            eq(customerCompanyMemberships.companyId, customerCompanies.id),
          )
          .where(inArray(customerCompanyMemberships.customerId, ids))
          .orderBy(asc(customerCompanies.name));

  const companiesByCustomer = new Map<string, string[]>();
  for (const row of memberships) {
    const list = companiesByCustomer.get(row.customerId) ?? [];
    list.push(row.companyName);
    companiesByCustomer.set(row.customerId, list);
  }

  return {
    ok: true,
    data: {
      customers: rows.map((row) => ({
        ...row,
        companies: companiesByCustomer.get(row.id) ?? [],
      })),
    },
  };
}

export async function submitFeedbackOnBehalfAction(input: {
  workspaceSlug: string;
  productSlug: string;
  customerId: string;
  boardId: string;
  title: string;
  body: string;
  category: "feature_request" | "bug" | "improvement" | "question";
  privacy?: "public" | "author" | "company";
}): Promise<ActionResult<{ postId: string }>> {
  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the form and try again.",
    };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "feedback:write",
  );
  if ("error" in authorized) return authorized.error;

  const { user, workspace, product } = authorized.context;
  const customer = await findCustomer(workspace.id, parsed.data.customerId);
  if (!customer) {
    return { ok: false, error: "That customer is not available in this workspace." };
  }

  const boardRows = await db
    .select({ id: boards.id })
    .from(boards)
    .where(
      and(
        eq(boards.id, parsed.data.boardId),
        eq(boards.productId, product.id),
        isNull(boards.archivedAt),
      ),
    )
    .limit(1);
  if (!boardRows[0]) {
    return { ok: false, error: "That board is not available in this product." };
  }

  if (!isFeedbackPrivacy(parsed.data.privacy)) {
    return { ok: false, error: "Choose a valid audience." };
  }
  if (parsed.data.privacy === "company" && !(await hasCompany(customer.id))) {
    return {
      ok: false,
      error: "That customer does not belong to a company, so the request cannot be company-only.",
    };
  }

  const limit = await consumeRateLimit({
    bucket: `feedback:on-behalf:submit:${workspace.id}:${user.id}`,
    limit: 20,
    windowSeconds: 60 * 60,
  });
  if (!limit.allowed) {
    return {
      ok: false,
      error: "Too many on-behalf submissions. Try again in a little while.",
    };
  }

  const inserted = await db
    .insert(feedbackPosts)
    .values({
      productId: product.id,
      boardId: boardRows[0].id,
      // Internal attribution: the operator who acted.
      authorId: user.id,
      // Public attribution: the real customer row, not a shadow identity.
      authorCustomerId: customer.id,
      authorLabel: customer.name ?? customer.email ?? null,
      title: parsed.data.title,
      body: parsed.data.body,
      category: parsed.data.category,
      status: "open",
      source: "in_app",
      privacy: parsed.data.privacy,
    })
    .returning({ id: feedbackPosts.id });

  const post = inserted[0];
  if (!post) return { ok: false, error: "Could not create the request." };

  await recordWorkspaceAudit({
    workspaceId: workspace.id,
    actorUserId: user.id,
    action: "feedback.submitted_on_behalf",
    targetType: "feedback_post",
    targetId: post.id,
    metadata: {
      operatorUserId: user.id,
      customerId: customer.id,
      boardId: boardRows[0].id,
      privacy: parsed.data.privacy,
    },
  });

  revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
  return { ok: true, data: { postId: post.id } };
}

export async function voteOnBehalfAction(input: {
  workspaceSlug: string;
  productSlug: string;
  customerId: string;
  postId: string;
}): Promise<ActionResult<{ added: boolean }>> {
  const parsed = voteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Choose a customer." };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "feedback:write",
  );
  if ("error" in authorized) return authorized.error;

  const { user, workspace, product } = authorized.context;
  const customer = await findCustomer(workspace.id, parsed.data.customerId);
  if (!customer) {
    return { ok: false, error: "That customer is not available in this workspace." };
  }

  const postRows = await db
    .select({ id: feedbackPosts.id })
    .from(feedbackPosts)
    .where(
      and(
        eq(feedbackPosts.id, parsed.data.postId),
        eq(feedbackPosts.productId, product.id),
        isNull(feedbackPosts.archivedAt),
        isNull(feedbackPosts.hiddenAt),
        isNull(feedbackPosts.mergedIntoId),
        // The customer must be able to see the request themselves; an operator
        // cannot use a proxy vote to widen a private request's audience.
        postPrivacySql(customer.id),
      ),
    )
    .limit(1);
  if (!postRows[0]) {
    return { ok: false, error: "That request is not available to this customer." };
  }

  const limit = await consumeRateLimit({
    bucket: `feedback:on-behalf:vote:${workspace.id}:${user.id}`,
    limit: 60,
    windowSeconds: 60 * 60,
  });
  if (!limit.allowed) {
    return {
      ok: false,
      error: "Too many on-behalf votes. Try again in a little while.",
    };
  }

  const inserted = await db
    .insert(feedbackCustomerVotes)
    .values({
      feedbackPostId: postRows[0].id,
      customerId: customer.id,
      castByUserId: user.id,
    })
    .onConflictDoNothing()
    .returning({ id: feedbackCustomerVotes.id });

  const added = inserted.length > 0;
  if (added) {
    await recordWorkspaceAudit({
      workspaceId: workspace.id,
      actorUserId: user.id,
      action: "feedback.vote_cast_on_behalf",
      targetType: "feedback_post",
      targetId: postRows[0].id,
      metadata: {
        operatorUserId: user.id,
        customerId: customer.id,
        voteId: inserted[0]?.id ?? null,
      },
    });
  }

  revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
  return { ok: true, data: { added } };
}
