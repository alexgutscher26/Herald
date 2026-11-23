import "server-only";

import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { workspaceWidgetSettings } from "@/db/schema";
import {
  DEFAULT_WIDGET_SECTIONS,
  isWidgetPosition,
  isWidgetTheme,
  normalizeWidgetOriginOverrides,
  normalizeWidgetSections,
  parseAllowedOrigins,
  parseWidgetOriginOverrides,
  type ConfiguredWidgetTheme,
  type WidgetOriginOverride,
  type WidgetPosition,
  type WidgetSection,
} from "./policy";

/**
 * Persisted widget configuration.
 *
 * A workspace gets its public key lazily, the first time the Widget page is
 * opened. Before that the embed route treats the workspace as unconfigured and
 * keeps the legacy no-key behaviour instead of locking out an installation
 * that has not been through the settings screen yet.
 */

export type WidgetSettingsView = {
  workspaceId: string;
  publicKey: string;
  allowedOrigins: string[];
  position: WidgetPosition;
  theme: ConfiguredWidgetTheme;
  sections: WidgetSection[];
  originOverrides: WidgetOriginOverride[];
  updatedAt: string;
};

export type WidgetAccessSettings = {
  publicKey: string;
  allowedOrigins: string[];
};

type Row = typeof workspaceWidgetSettings.$inferSelect;

function toView(row: Row): WidgetSettingsView {
  return {
    workspaceId: row.workspaceId,
    publicKey: row.publicKey,
    allowedOrigins: row.allowedOrigins,
    position: isWidgetPosition(row.position) ? row.position : "bottom-right",
    theme: isWidgetTheme(row.theme) ? row.theme : "auto",
    sections: normalizeWidgetSections(row.sections ?? DEFAULT_WIDGET_SECTIONS),
    originOverrides: normalizeWidgetOriginOverrides(row.originOverrides),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function newPublicKey(): string {
  return `hpk_${randomBytes(24).toString("base64url")}`;
}

async function selectSettings(workspaceId: string): Promise<Row | null> {
  const rows = await db
    .select()
    .from(workspaceWidgetSettings)
    .where(eq(workspaceWidgetSettings.workspaceId, workspaceId))
    .limit(1);
  return rows[0] ?? null;
}

/** Read configuration without creating a key. */
export async function readWidgetSettings(
  workspaceId: string,
): Promise<WidgetSettingsView | null> {
  const row = await selectSettings(workspaceId);
  return row ? toView(row) : null;
}

/** Read only what the embed gate needs. */
export async function readWidgetAccessSettings(
  workspaceId: string,
): Promise<WidgetAccessSettings | null> {
  const row = await selectSettings(workspaceId);
  return row
    ? { publicKey: row.publicKey, allowedOrigins: row.allowedOrigins }
    : null;
}

/**
 * Read the configuration, creating the stable public key if necessary.
 *
 * Two concurrent dashboard requests may generate different keys; the primary
 * key conflict is ignored and the winner is selected, so the displayed key is
 * always the one the embed route will accept.
 */
export async function ensureWidgetSettings(
  workspaceId: string,
): Promise<WidgetSettingsView> {
  const existing = await selectSettings(workspaceId);
  if (existing) return toView(existing);

  const now = new Date();
  const inserted = await db
    .insert(workspaceWidgetSettings)
    .values({
      workspaceId,
      publicKey: newPublicKey(),
      allowedOrigins: [],
      position: "bottom-right",
      theme: "auto",
      sections: DEFAULT_WIDGET_SECTIONS,
      originOverrides: [],
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted[0]) return toView(inserted[0]);

  const raced = await selectSettings(workspaceId);
  if (!raced) throw new Error("Widget settings could not be created.");
  return toView(raced);
}

export type SaveWidgetSettingsInput = {
  workspaceId: string;
  allowedOrigins: readonly string[];
  position: string;
  theme: string;
  sections: readonly string[];
  originOverrides: readonly unknown[];
};

export type SaveWidgetSettingsResult =
  | { ok: true; settings: WidgetSettingsView }
  | { ok: false; error: string };

export async function saveWidgetSettings(
  input: SaveWidgetSettingsInput,
): Promise<SaveWidgetSettingsResult> {
  const parsedOrigins = parseAllowedOrigins(input.allowedOrigins);
  if (!parsedOrigins.ok) return parsedOrigins;

  if (!isWidgetPosition(input.position)) {
    return { ok: false, error: "Choose a supported widget position." };
  }
  if (!isWidgetTheme(input.theme)) {
    return { ok: false, error: "Choose a supported widget theme." };
  }

  const sections = normalizeWidgetSections(input.sections);
  const parsedOverrides = parseWidgetOriginOverrides(
    input.originOverrides,
    parsedOrigins.origins,
  );
  if (!parsedOverrides.ok) return parsedOverrides;

  await ensureWidgetSettings(input.workspaceId);
  const now = new Date();
  const updated = await db
    .update(workspaceWidgetSettings)
    .set({
      allowedOrigins: parsedOrigins.origins,
      position: input.position,
      theme: input.theme,
      sections,
      originOverrides: parsedOverrides.overrides,
      updatedAt: now,
    })
    .where(eq(workspaceWidgetSettings.workspaceId, input.workspaceId))
    .returning();

  if (!updated[0]) {
    return { ok: false, error: "Widget settings are not available." };
  }

  return { ok: true, settings: toView(updated[0]) };
}
