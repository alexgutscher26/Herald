import "server-only";

import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import { boardAccessRules, boards } from "@/db/schema/boards";
import {
  customerCompanies,
  customerCompanyMemberships,
  customers,
} from "@/db/schema/customers";
import { intakeQuestions } from "@/db/schema/support";

import {
  EMPTY_SEGMENTS,
  boardMatchesSegments,
  normalizeAccessRules,
  normalizeDomain,
  type AccessRuleInput,
  type BoardAccessRule,
  type ViewerSegments,
} from "./segments";

export * from "./segments";

export type AccessiblePublicBoard = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  position: number;
  settings: (typeof boards.$inferSelect)["settings"];
};

/**
 * Public, live boards the visitor may see.
 *
 * Used by projections that span boards (roadmaps and llms.txt), so they cannot
 * accidentally include a private, archived or segment-gated board just because
 * they did not go through `resolvePublicBoard`. Anonymous visitors match only
 * ungated boards.
 */
export async function loadAccessiblePublicBoards(input: {
  productId: string;
  workspaceId: string;
  viewerCustomerId?: string | null | undefined;
  boardIds?: string[] | undefined;
}): Promise<AccessiblePublicBoard[]> {
  // An explicit empty selection means "no boards", not "all boards".
  if (input.boardIds !== undefined && input.boardIds.length === 0) return [];

  const rows = await db
    .select({
      id: boards.id,
      name: boards.name,
      slug: boards.slug,
      description: boards.description,
      position: boards.position,
      settings: boards.settings,
    })
    .from(boards)
    .where(
      and(
        eq(boards.productId, input.productId),
        eq(boards.visibility, "public"),
        isNull(boards.archivedAt),
        input.boardIds && input.boardIds.length > 0
          ? inArray(boards.id, input.boardIds)
          : undefined,
      ),
    )
    .orderBy(asc(boards.position), asc(boards.name));

  if (rows.length === 0) return [];

  const rules = await db
    .select({
      boardId: boardAccessRules.boardId,
      match: boardAccessRules.match,
      value: boardAccessRules.value,
      traitKey: boardAccessRules.traitKey,
    })
    .from(boardAccessRules)
    .where(inArray(boardAccessRules.boardId, rows.map((row) => row.id)));

  if (rules.length === 0) return rows;

  const byBoard = new Map<string, typeof rules>();
  for (const rule of rules) {
    const list = byBoard.get(rule.boardId) ?? [];
    list.push(rule);
    byBoard.set(rule.boardId, list);
  }

  const segments = await loadViewerSegments({
    workspaceId: input.workspaceId,
    customerId: input.viewerCustomerId ?? null,
  });

  return rows.filter((board) => {
    const boardRules = byBoard.get(board.id) ?? [];
    return boardRules.length === 0 || boardMatchesSegments(boardRules, segments);
  });
}

/**
 * The stored half of segment gating.
 *
 * Everything decision-shaped lives in `segments.ts`; this module only reads the
 * rows and writes the rule set. The resolver is the only caller that decides
 * visibility, which is what keeps gating out of the UI.
 */

/** Rules for one board. Empty means the board is open. */
export async function loadBoardAccessRules(boardId: string): Promise<BoardAccessRule[]> {
  return db
    .select({
      match: boardAccessRules.match,
      value: boardAccessRules.value,
      traitKey: boardAccessRules.traitKey,
    })
    .from(boardAccessRules)
    .where(eq(boardAccessRules.boardId, boardId));
}

/**
 * Load the segments of one visitor.
 *
 * A signed-out visitor has none, so every gated board denies them without an
 * extra query — callers only reach here when the board actually has rules.
 */
export async function loadViewerSegments(input: {
  workspaceId: string;
  customerId: string | null;
}): Promise<ViewerSegments> {
  if (!input.customerId) return EMPTY_SEGMENTS;

  const customerRows = await db
    .select({ email: customers.email, traits: customers.traits })
    .from(customers)
    .where(
      and(
        eq(customers.id, input.customerId),
        eq(customers.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);

  const customer = customerRows[0];
  if (!customer) return EMPTY_SEGMENTS;

  const email = customer.email?.trim().toLowerCase() ?? "";
  const domainPart = email.includes("@") ? email.split("@")[1] : undefined;
  const emailDomain = domainPart ? normalizeDomain(domainPart) : null;

  const memberships = await db
    .select({ companyId: customerCompanies.id, traits: customerCompanies.traits })
    .from(customerCompanyMemberships)
    .innerJoin(
      customerCompanies,
      and(
        eq(customerCompanies.id, customerCompanyMemberships.companyId),
        eq(customerCompanies.workspaceId, input.workspaceId),
      ),
    )
    .where(
      and(
        eq(customerCompanyMemberships.customerId, input.customerId),
        eq(customerCompanyMemberships.workspaceId, input.workspaceId),
      ),
    );

  return {
    customerId: input.customerId,
    emailDomain,
    companyIds: memberships.map((row) => row.companyId),
    customerTraits: customer.traits,
    companyTraits: memberships.map((row) => row.traits),
  };
}

/**
 * Replace a board's rule set.
 *
 * The board is resolved inside the product first, so a foreign board id edits
 * nothing. An empty array makes the board open again.
 */
export async function replaceBoardAccessRules(input: {
  productId: string;
  boardId: string;
  rules: AccessRuleInput[];
}): Promise<{ ok: true; rules: BoardAccessRule[] } | { ok: false; error: string }> {
  const normalized = normalizeAccessRules(input.rules);
  if (!normalized.ok) return normalized;

  const board = await db
    .select({ id: boards.id })
    .from(boards)
    .where(and(eq(boards.id, input.boardId), eq(boards.productId, input.productId)))
    .limit(1);
  if (!board[0]) return { ok: false, error: "That board no longer exists." };

  // The inverse of the check in `createIntakeQuestion`: a key that a public
  // form collects must never become an authorization signal, including for
  // questions that were archived after collecting answers.
  const traitKeys = [
    ...new Set(
      normalized.rules
        .filter((rule) => rule.match === "trait")
        .map((rule) => rule.traitKey),
    ),
  ];
  if (traitKeys.length > 0) {
    const collected = await db
      .select({ key: intakeQuestions.key })
      .from(intakeQuestions)
      .where(
        and(
          eq(intakeQuestions.productId, input.productId),
          inArray(intakeQuestions.key, traitKeys),
        ),
      )
      .limit(1);
    if (collected[0]) {
      return {
        ok: false,
        error: `“${collected[0].key}” is collected from a public intake form, so it cannot gate a board.`,
      };
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(boardAccessRules).where(eq(boardAccessRules.boardId, input.boardId));
    if (normalized.rules.length > 0) {
      await tx.insert(boardAccessRules).values(
        normalized.rules.map((rule) => ({
          boardId: input.boardId,
          productId: input.productId,
          match: rule.match,
          value: rule.value,
          traitKey: rule.traitKey,
        })),
      );
    }
  });

  return { ok: true, rules: normalized.rules };
}
