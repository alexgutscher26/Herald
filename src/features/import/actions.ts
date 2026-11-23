"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { authorizeProductAction } from "@/features/live/action-auth";
import type { ActionResult } from "@/features/live/action-result";
import {
  deleteImportPreset,
  listImportPresets,
  saveImportPreset,
} from "@/features/import/service";
import { isImportFormat, type ImportMapping } from "@/features/import/types";
import type { ImportPresetView } from "@/features/import/presets";

const mappingSchema = z.record(z.string(), z.string());

export async function saveImportPresetAction(input: {
  workspaceSlug: string;
  productSlug: string;
  name: string;
  format: string;
  headers: string[];
  mapping: Record<string, string>;
}): Promise<ActionResult<{ preset: ImportPresetView }>> {
  const parsed = z
    .object({
      workspaceSlug: z.string().min(1),
      productSlug: z.string().min(1),
      name: z.string().trim().min(2).max(80),
      format: z.string().min(1),
      headers: z.array(z.string()).min(1).max(500),
      mapping: mappingSchema,
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the preset name and mapping." };
  if (!isImportFormat(parsed.data.format)) {
    return { ok: false, error: "Choose a known source format." };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;

  const saved = await saveImportPreset({
    workspaceId: authorized.context.workspace.id,
    createdBy: authorized.context.user.id,
    name: parsed.data.name,
    format: parsed.data.format,
    headers: parsed.data.headers,
    mapping: parsed.data.mapping as ImportMapping,
  });
  if (!saved.ok) return saved;

  revalidatePath(
    `/app/${parsed.data.workspaceSlug}/${parsed.data.productSlug}/import`,
  );
  return { ok: true, data: { preset: saved.preset } };
}

export async function deleteImportPresetAction(input: {
  workspaceSlug: string;
  productSlug: string;
  presetId: string;
}): Promise<ActionResult<{ presets: ImportPresetView[] }>> {
  const parsed = z
    .object({
      workspaceSlug: z.string().min(1),
      productSlug: z.string().min(1),
      presetId: z.uuid(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "That preset is not valid." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;

  const deleted = await deleteImportPreset(
    authorized.context.workspace.id,
    parsed.data.presetId,
  );
  if (!deleted) return { ok: false, error: "That preset no longer exists." };

  const presets = await listImportPresets(authorized.context.workspace.id);
  revalidatePath(
    `/app/${parsed.data.workspaceSlug}/${parsed.data.productSlug}/import`,
  );
  return { ok: true, data: { presets } };
}
