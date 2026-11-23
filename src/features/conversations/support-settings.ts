import "server-only";

import { and, asc, eq, isNull, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { boardAccessRules, boards } from "@/db/schema/boards";
import { customers } from "@/db/schema/customers";
import {
  intakeQuestions,
  productSupportSettings,
  type IntakeChannel,
  type ProductSupportSettings,
} from "@/db/schema/support";
import { isValidTimezone, normalizeSchedule } from "@/features/operators/schedule";

import {
  INTAKE_QUESTION_LIMIT,
  normalizeIntakeOptions,
  parseIntakeAnswers,
  type IntakeQuestionView,
} from "./intake";

/**
 * Support configuration and intake writes.
 *
 * The dashboard actions authorize the product before calling these functions;
 * every query below is scoped by the product id they pass. CSAT is off unless
 * a row says otherwise, and a missing settings row is created lazily so the
 * settings screen can render a real switch.
 */

export async function ensureProductSupportSettings(
  productId: string,
): Promise<ProductSupportSettings> {
  await db
    .insert(productSupportSettings)
    .values({ productId })
    .onConflictDoNothing();

  const rows = await db
    .select()
    .from(productSupportSettings)
    .where(eq(productSupportSettings.productId, productId))
    .limit(1);

  const settings = rows[0];
  if (!settings) throw new Error("Could not load support settings.");
  return settings;
}

export async function saveSlaSetting(input: {
  productId: string;
  enabled: boolean;
  firstResponseMinutes: number;
  timezone: string;
  businessHours: unknown;
  now?: Date;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isValidTimezone(input.timezone)) {
    return { ok: false, error: "Choose a valid IANA timezone, for example Europe/Berlin." };
  }
  if (
    !Number.isInteger(input.firstResponseMinutes) ||
    input.firstResponseMinutes < 5 ||
    input.firstResponseMinutes > 10_080
  ) {
    return { ok: false, error: "Choose a first-response target from 5 to 10,080 minutes." };
  }

  const schedule = normalizeSchedule(input.businessHours);
  if (!schedule.ok) return { ok: false, error: schedule.error };

  const now = input.now ?? new Date();
  await db
    .insert(productSupportSettings)
    .values({
      productId: input.productId,
      slaEnabled: input.enabled,
      slaFirstResponseMinutes: input.firstResponseMinutes,
      slaTimezone: input.timezone,
      slaBusinessHours: schedule.schedule,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: productSupportSettings.productId,
      set: {
        slaEnabled: input.enabled,
        slaFirstResponseMinutes: input.firstResponseMinutes,
        slaTimezone: input.timezone,
        slaBusinessHours: schedule.schedule,
        updatedAt: now,
      },
    });

  return { ok: true };
}

export async function saveCsatSetting(input: {
  productId: string;
  enabled: boolean;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  await db
    .insert(productSupportSettings)
    .values({
      productId: input.productId,
      csatEnabled: input.enabled,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: productSupportSettings.productId,
      set: { csatEnabled: input.enabled, updatedAt: now },
    });
}

type QuestionRow = {
  id: string;
  key: string;
  label: string;
  kind: "text" | "select";
  options: string[] | null;
  boardId: string | null;
  channel: IntakeChannel;
  active: boolean;
};

function toView(row: QuestionRow): IntakeQuestionView {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    kind: row.kind,
    options: normalizeIntakeOptions(row.options),
  };
}

/**
 * Questions a public surface should ask.
 *
 * A widget question is product-wide (`board_id` null). A board question is
 * either scoped to that board or, when `board_id` is null, applies to every
 * board. Email has no form, so its list is intentionally empty.
 */
export async function listIntakeQuestions(input: {
  productId: string;
  channel: IntakeChannel;
  boardId?: string | null;
  includeInactive?: boolean;
}): Promise<IntakeQuestionView[]> {
  if (input.channel === "email") return [];

  const conditions = [
    eq(intakeQuestions.productId, input.productId),
    eq(intakeQuestions.channel, input.channel),
  ];
  if (!input.includeInactive) conditions.push(eq(intakeQuestions.active, true));

  if (input.channel === "widget") {
    conditions.push(isNull(intakeQuestions.boardId));
  } else if (input.boardId) {
    conditions.push(
      or(
        eq(intakeQuestions.boardId, input.boardId),
        isNull(intakeQuestions.boardId),
      )!,
    );
  } else {
    conditions.push(isNull(intakeQuestions.boardId));
  }

  const rows = await db
    .select({
      id: intakeQuestions.id,
      key: intakeQuestions.key,
      label: intakeQuestions.label,
      kind: intakeQuestions.kind,
      options: intakeQuestions.options,
      boardId: intakeQuestions.boardId,
      channel: intakeQuestions.channel,
      active: intakeQuestions.active,
    })
    .from(intakeQuestions)
    .where(and(...conditions))
    .orderBy(asc(intakeQuestions.position), asc(intakeQuestions.label))
    .limit(INTAKE_QUESTION_LIMIT);

  return rows.map(toView);
}

export async function listIntakeQuestionsForSettings(
  productId: string,
): Promise<
  Array<
    IntakeQuestionView & {
      channel: IntakeChannel;
      boardId: string | null;
      boardName: string | null;
      active: boolean;
    }
  >
> {
  const rows = await db
    .select({
      id: intakeQuestions.id,
      key: intakeQuestions.key,
      label: intakeQuestions.label,
      kind: intakeQuestions.kind,
      options: intakeQuestions.options,
      boardId: intakeQuestions.boardId,
      channel: intakeQuestions.channel,
      active: intakeQuestions.active,
      boardName: boards.name,
    })
    .from(intakeQuestions)
    .leftJoin(
      boards,
      and(eq(boards.id, intakeQuestions.boardId), eq(boards.productId, productId)),
    )
    .where(eq(intakeQuestions.productId, productId))
    .orderBy(
      asc(intakeQuestions.channel),
      asc(intakeQuestions.position),
      asc(intakeQuestions.label),
    )
    .limit(50);

  return rows.map((row) => ({
    ...toView(row),
    channel: row.channel,
    boardId: row.boardId,
    boardName: row.boardName,
    active: row.active,
  }));
}

export async function createIntakeQuestion(input: {
  productId: string;
  channel: IntakeChannel;
  boardId?: string | null;
  key: string;
  label: string;
  kind: "text" | "select";
  options?: string[];
  now?: Date;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const channel = input.channel;
  if (channel === "email") {
    return {
      ok: false,
      error: "Email has no intake form; choose the widget or a board.",
    };
  }

  const boardId = channel === "board" ? input.boardId ?? null : null;

  if (boardId) {
    const board = await db
      .select({ id: boards.id })
      .from(boards)
      .where(and(eq(boards.id, boardId), eq(boards.productId, input.productId)))
      .limit(1);
    if (!board[0]) return { ok: false, error: "That board is not in this product." };
  }

  const key = input.key.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) {
    return {
      ok: false,
      error:
        "Use a trait key that starts with a letter and contains only lowercase letters, numbers and underscores.",
    };
  }

  // A public form must never write a trait that authorizes a gated board.
  // Requiring the key to be free of access rules keeps self-reported answers
  // out of the segmentation decision entirely.
  const gated = await db
    .select({ id: boardAccessRules.id })
    .from(boardAccessRules)
    .where(
      and(
        eq(boardAccessRules.productId, input.productId),
        eq(boardAccessRules.match, "trait"),
        eq(boardAccessRules.traitKey, key),
      ),
    )
    .limit(1);
  if (gated[0]) {
    return {
      ok: false,
      error: `“${key}” gates a board, so it cannot be collected from a public form. Choose another trait key.`,
    };
  }

  const label = input.label.trim();
  if (label.length < 2 || label.length > 120) {
    return { ok: false, error: "Give the question a label of 2–120 characters." };
  }

  const kind = input.kind;
  const options =
    kind === "select" ? normalizeIntakeOptions(input.options ?? []) : [];
  if (kind === "select" && options.length < 2) {
    return { ok: false, error: "A choice question needs at least two options." };
  }

  const duplicate = await db
    .select({ id: intakeQuestions.id })
    .from(intakeQuestions)
    .where(
      and(
        eq(intakeQuestions.productId, input.productId),
        eq(intakeQuestions.channel, channel),
        boardId
          ? eq(intakeQuestions.boardId, boardId)
          : isNull(intakeQuestions.boardId),
        eq(intakeQuestions.key, key),
      ),
    )
    .limit(1);
  if (duplicate[0]) {
    return { ok: false, error: "That trait key is already used for this channel." };
  }

  const positions = await db
    .select({ value: sql<number>`coalesce(max(${intakeQuestions.position}), -1)::int` })
    .from(intakeQuestions)
    .where(eq(intakeQuestions.productId, input.productId));
  const position = (positions[0]?.value ?? -1) + 1;
  const now = input.now ?? new Date();

  const inserted = await db
    .insert(intakeQuestions)
    .values({
      productId: input.productId,
      boardId,
      channel,
      key,
      label,
      kind,
      options,
      position,
      updatedAt: now,
    })
    .returning({ id: intakeQuestions.id });

  const question = inserted[0];
  if (!question) return { ok: false, error: "Could not add that question." };
  return { ok: true, id: question.id };
}

export async function archiveIntakeQuestion(input: {
  productId: string;
  questionId: string;
  now?: Date;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const updated = await db
    .update(intakeQuestions)
    .set({ active: false, updatedAt: input.now ?? new Date() })
    .where(
      and(
        eq(intakeQuestions.id, input.questionId),
        eq(intakeQuestions.productId, input.productId),
      ),
    )
    .returning({ id: intakeQuestions.id });

  if (updated.length === 0) return { ok: false, error: "That question no longer exists." };
  return { ok: true };
}

/**
 * Merge validated answers into the customer's traits.
 *
 * This is always best-effort: an unanswered form yields `{}`, and invalid
 * values never reach the database. The caller decides whether a merge failure
 * should fail the surrounding request; it is intentionally not thrown here so
 * a missing question row cannot block a guest submission.
 */
export async function applyIntakeTraits(input: {
  productId: string;
  channel: IntakeChannel;
  boardId?: string | null;
  customerId: string;
  answers: unknown;
  now?: Date;
}): Promise<Record<string, string>> {
  const questions = await listIntakeQuestions({
    productId: input.productId,
    channel: input.channel,
    boardId: input.boardId ?? null,
  });
  const traits = parseIntakeAnswers(questions, input.answers);
  if (Object.keys(traits).length === 0) return {};

  await db
    .update(customers)
    .set({
      traits: sql`${customers.traits} || ${JSON.stringify(traits)}::jsonb`,
      updatedAt: input.now ?? new Date(),
    })
    .where(eq(customers.id, input.customerId));

  return traits;
}
