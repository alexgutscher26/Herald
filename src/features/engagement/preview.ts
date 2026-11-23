import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt } from "drizzle-orm";

import { db } from "@/db";
import { products, widgetExperiences, workspaces } from "@/db/schema";

import type { ExperienceContent } from "@/db/schema/engagement";

/**
 * Preview links for tours and banners.
 *
 * A preview is a short-lived bearer link: the token appears once in the URL,
 * only its SHA-256 is stored, and it expires after an hour. Resolving one lets
 * the embed route bypass the origin allowlist and lets the experiences API
 * return exactly that draft, ignoring status, schedule, audience, dismissals and
 * frequency. Nothing is recorded while previewing.
 */

export const PREVIEW_TTL_MS = 60 * 60 * 1000;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{24,120}$/;

export function hashPreviewToken(token: string): string | null {
  if (!TOKEN_PATTERN.test(token)) return null;
  return createHash("sha256").update(token).digest("hex");
}

export async function createExperiencePreviewToken(
  productId: string,
  experienceId: string,
): Promise<{ token: string; expiresAt: Date } | null> {
  const token = randomBytes(24).toString("base64url");
  const hash = hashPreviewToken(token);
  if (!hash) return null;
  const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS);

  const updated = await db
    .update(widgetExperiences)
    .set({
      previewTokenHash: hash,
      previewExpiresAt: expiresAt,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(widgetExperiences.id, experienceId),
        eq(widgetExperiences.productId, productId),
      ),
    )
    .returning({ id: widgetExperiences.id });
  return updated[0] ? { token, expiresAt } : null;
}

export type ExperiencePreview = {
  experienceId: string;
  workspaceId: string;
  workspaceSlug: string;
  productId: string;
  productSlug: string;
  name: string;
  kind: "tour" | "banner";
  content: ExperienceContent;
  defaultLocale: string;
  dismissDays: number;
};

export async function resolveExperiencePreview(
  token: string,
): Promise<ExperiencePreview | null> {
  const hash = hashPreviewToken(token);
  if (!hash) return null;

  const rows = await db
    .select({
      experienceId: widgetExperiences.id,
      workspaceId: widgetExperiences.workspaceId,
      workspaceSlug: workspaces.slug,
      productId: widgetExperiences.productId,
      productSlug: products.slug,
      name: widgetExperiences.name,
      kind: widgetExperiences.kind,
      content: widgetExperiences.content,
      defaultLocale: widgetExperiences.defaultLocale,
      dismissDays: widgetExperiences.dismissDays,
    })
    .from(widgetExperiences)
    .innerJoin(workspaces, eq(widgetExperiences.workspaceId, workspaces.id))
    .innerJoin(products, eq(widgetExperiences.productId, products.id))
    .where(
      and(
        eq(widgetExperiences.previewTokenHash, hash),
        gt(widgetExperiences.previewExpiresAt, new Date()),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Used by the embed gate: only a live token for this product skips origins. */
export async function experiencePreviewMatches(
  token: string,
  productId: string,
): Promise<boolean> {
  const hash = hashPreviewToken(token);
  if (!hash) return false;
  const rows = await db
    .select({ id: widgetExperiences.id })
    .from(widgetExperiences)
    .where(
      and(
        eq(widgetExperiences.previewTokenHash, hash),
        eq(widgetExperiences.productId, productId),
        gt(widgetExperiences.previewExpiresAt, new Date()),
      ),
    )
    .limit(1);
  return Boolean(rows[0]);
}
