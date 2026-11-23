import { z } from "zod";

/**
 * Uploaded release covers.
 *
 * An upload is validated and stored by the storage module; the release row and
 * its revisions keep only the generated key. The key shape is checked on every
 * write, so a client can never point a cover at another product's object, at an
 * inline `data:` URL, or at an arbitrary path.
 */

export const COVER_PRESETS = ["grid", "orbit", "waves", "plain"] as const;

/**
 * `workspaces/{workspaceId}/products/{productId}/cover/{id}.{ext}`, as produced
 * by `buildStorageKey` in `src/features/storage/limits.ts`.
 */
const CUSTOM_COVER_KEY =
  /^workspaces\/[0-9a-fA-F-]{8,64}\/products\/[0-9a-fA-F-]{8,64}\/cover\/[A-Za-z0-9][A-Za-z0-9._-]{0,160}$/;

export function isCustomCoverKey(value: string): boolean {
  return CUSTOM_COVER_KEY.test(value);
}

/**
 * Persisted cover input.
 *
 * Only a storage key is accepted: an upload's bytes live in the storage module,
 * and a client-supplied image payload is rejected instead of written to a row.
 */
export const coverInputSchema = z.union([
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("preset"), preset: z.enum(COVER_PRESETS) }),
  z.object({
    kind: z.literal("custom"),
    key: z
      .string()
      .max(512)
      .refine(isCustomCoverKey, "Upload the cover image again."),
  }),
]);

export type CoverInput = z.infer<typeof coverInputSchema>;
