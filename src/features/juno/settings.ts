import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { products } from "@/db/schema/workspaces";
import { getWorkspacePlan } from "@/features/entitlements/entitlements";
import {
  hasFeature,
  isJunoModelAllowed,
  planDefinition,
} from "@/features/entitlements/plans";
import {
  junoSettings,
  type JunoSettings,
  junoDuplicateModeEnum,
  junoFormalityEnum,
  junoReplyLengthEnum,
  junoToneEnum,
} from "@/db/schema/knowledge";
import { getAiConfig } from "@/lib/env";

import { assertModelChangeAllowed } from "./evaluation";

/**
 * Juno configuration.
 *
 * The row is created on first read so a product has deterministic defaults.
 * The model is deployment configuration: a request may only keep the model
 * already configured in `AI_MODEL`, never point Juno at an arbitrary paid
 * model from the browser.
 */

export const JUNO_TONES = junoToneEnum.enumValues;
export const JUNO_REPLY_LENGTHS = junoReplyLengthEnum.enumValues;
export const JUNO_FORMALITIES = junoFormalityEnum.enumValues;
export const JUNO_DUPLICATE_MODES = junoDuplicateModeEnum.enumValues;

const LANGUAGE_PATTERN = /^(auto|workspace|[a-z]{2,3}(-[A-Za-z0-9]{2,8})?)$/;

export async function ensureJunoSettings(productId: string): Promise<JunoSettings> {
  const existing = await db
    .select()
    .from(junoSettings)
    .where(eq(junoSettings.productId, productId))
    .limit(1);
  if (existing[0]) return existing[0];

  await db.insert(junoSettings).values({ productId }).onConflictDoNothing();

  const created = await db
    .select()
    .from(junoSettings)
    .where(eq(junoSettings.productId, productId))
    .limit(1);
  const row = created[0];
  if (!row) throw new Error("Could not create Juno settings.");
  return row;
}

export type SaveJunoSettingsInput = {
  productId: string;
  enabled: boolean;
  duplicateMode: string;
  submissionAssistantEnabled: boolean;
  tone: string;
  replyLength: string;
  formality: string;
  emoji: boolean;
  language: string;
  model: string;
  confidenceFloor: number;
  dailyBudgetCents: number;
  autoResolveChatMinutes: number;
  autoResolveEmailMinutes: number;
};

export type SettingsResult =
  | { ok: true; settings: JunoSettings }
  | { ok: false; error: string };

export async function saveJunoSettings(
  input: SaveJunoSettingsInput,
): Promise<SettingsResult> {
  if (!JUNO_TONES.includes(input.tone as (typeof JUNO_TONES)[number])) {
    return { ok: false, error: "Choose a supported tone." };
  }
  if (
    !JUNO_DUPLICATE_MODES.includes(
      input.duplicateMode as (typeof JUNO_DUPLICATE_MODES)[number],
    )
  ) {
    return { ok: false, error: "Choose a supported duplicate mode." };
  }
  if (
    !JUNO_REPLY_LENGTHS.includes(
      input.replyLength as (typeof JUNO_REPLY_LENGTHS)[number],
    )
  ) {
    return { ok: false, error: "Choose a supported reply length." };
  }
  if (
    !JUNO_FORMALITIES.includes(
      input.formality as (typeof JUNO_FORMALITIES)[number],
    )
  ) {
    return { ok: false, error: "Choose a supported formality." };
  }

  const language = input.language.trim();
  if (!LANGUAGE_PATTERN.test(language)) {
          return {
        ok: false,
        error:
          "Use `auto`, `workspace`, or a language tag such as `en` or `pt-BR`.",
      };
  }

  const productRows = await db
    .select({ workspaceId: products.workspaceId })
    .from(products)
    .where(eq(products.id, input.productId))
    .limit(1);
  const workspaceId = productRows[0]?.workspaceId;
  if (!workspaceId) return { ok: false, error: "That product no longer exists." };

  const plan = await getWorkspacePlan(workspaceId);
  if (input.enabled && !hasFeature(plan, "ai")) {
    return {
      ok: false,
      error: `Juno is included on Professional and Founding Lifetime, not ${planDefinition(plan).name}.`,
    };
  }

  const model = input.model.trim();
  // A downgraded workspace must still be able to turn Juno off even if its
  // stored model is no longer on the plan's allowlist. Only read the deployment
  // config when this save can actually select a model.
  if (input.enabled && model !== "") {
    const configured = getAiConfig()?.AI_MODEL ?? null;
    if (!configured) {
      return {
        ok: false,
        error: "Set AI_MODEL in the deployment environment before choosing a model.",
      };
    }
    if (!isJunoModelAllowed(plan, configured, model)) {
      return {
        ok: false,
        error: `The ${planDefinition(plan).name} plan does not allow the ${model} model.`,
      };
    }
  }

  if (
    !Number.isFinite(input.confidenceFloor) ||
    input.confidenceFloor < 0 ||
    input.confidenceFloor > 1
  ) {
    return { ok: false, error: "The confidence floor must be between 0 and 1." };
  }
  if (
    !Number.isInteger(input.dailyBudgetCents) ||
    input.dailyBudgetCents < 0 ||
    input.dailyBudgetCents > 100_000
  ) {
    return { ok: false, error: "The daily budget must be between 0 and 100000 cents." };
  }
  for (const minutes of [
    input.autoResolveChatMinutes,
    input.autoResolveEmailMinutes,
  ]) {
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 43_200) {
      return { ok: false, error: "Auto-resolve timers must be between 0 and 43200 minutes." };
    }
  }

  const current = await ensureJunoSettings(input.productId);
  const nextModel = model === "" ? null : model;
  const gate = await assertModelChangeAllowed({
    productId: input.productId,
    currentModel: current.model,
    nextModel,
  });
  if (!gate.ok) return { ok: false, error: gate.error };

  const updated = await db
    .update(junoSettings)
    .set({
      enabled: input.enabled,
      duplicateMode: input.duplicateMode as (typeof JUNO_DUPLICATE_MODES)[number],
      submissionAssistantEnabled: input.submissionAssistantEnabled,
      tone: input.tone as (typeof JUNO_TONES)[number],
      replyLength: input.replyLength as (typeof JUNO_REPLY_LENGTHS)[number],
      formality: input.formality as (typeof JUNO_FORMALITIES)[number],
      emoji: input.emoji,
      language,
      model: model === "" ? null : model,
      confidenceFloor: input.confidenceFloor,
      dailyBudgetCents: input.dailyBudgetCents,
      autoResolveChatMinutes: input.autoResolveChatMinutes,
      autoResolveEmailMinutes: input.autoResolveEmailMinutes,
      updatedAt: new Date(),
    })
    .where(eq(junoSettings.productId, input.productId))
    .returning();

  const row = updated[0];
  if (!row) return { ok: false, error: "Could not save Juno settings." };
  return { ok: true, settings: row };
}
