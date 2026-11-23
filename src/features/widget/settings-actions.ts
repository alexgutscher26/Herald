"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { authorizeProductAction } from "@/features/live/action-auth";
import type { ActionResult } from "@/features/live/action-result";

import {
  WIDGET_POSITIONS,
  WIDGET_SECTIONS,
  WIDGET_THEMES,
} from "./policy";
import { saveWidgetSettings, type WidgetSettingsView } from "./settings";

const saveSchema = z.object({
  workspaceSlug: z.string().min(1),
  productSlug: z.string().min(1),
  allowedOrigins: z.array(z.string().max(300)).max(20),
  position: z.enum(WIDGET_POSITIONS),
  theme: z.enum(WIDGET_THEMES),
  sections: z.array(z.enum(WIDGET_SECTIONS)).max(WIDGET_SECTIONS.length),
  originOverrides: z
    .array(
      z.object({
        origin: z.string().max(300),
        theme: z.enum(WIDGET_THEMES).optional(),
        position: z.enum(WIDGET_POSITIONS).optional(),
      }),
    )
    .max(20),
});

export async function saveWidgetSettingsAction(input: {
  workspaceSlug: string;
  productSlug: string;
  allowedOrigins: string[];
  position: string;
  theme: string;
  sections: string[];
  originOverrides: {
    origin: string;
    theme?: string;
    position?: string;
  }[];
}): Promise<ActionResult<{ settings: WidgetSettingsView }>> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error:
        parsed.error.issues[0]?.message ??
        "Check the widget settings and try again.",
    };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "widget:manage",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await saveWidgetSettings({
      workspaceId: authorized.context.workspace.id,
      allowedOrigins: parsed.data.allowedOrigins,
      position: parsed.data.position,
      theme: parsed.data.theme,
      sections: parsed.data.sections,
      originOverrides: parsed.data.originOverrides,
    });
    if (!result.ok) return result;

    revalidatePath(
      `/app/${parsed.data.workspaceSlug}/${parsed.data.productSlug}/widget`,
    );
    return { ok: true, data: { settings: result.settings } };
  } catch (error) {
    console.error("[widget] save settings failed", error);
    return { ok: false, error: "Could not save the widget settings." };
  }
}
