import { z } from "zod";

/**
 * Uploaded social-share (Open Graph) images.
 *
 * The key shape is checked on every write, so an entry can only point at an
 * object produced by the release social-image upload route for its own product.
 */
const SOCIAL_IMAGE_KEY =
  /^workspaces\/[0-9a-fA-F-]{8,64}\/products\/[0-9a-fA-F-]{8,64}\/social\/[A-Za-z0-9][A-Za-z0-9._-]{0,160}$/;

export function isSocialImageKey(value: string): boolean {
  return SOCIAL_IMAGE_KEY.test(value);
}

export const socialImageKeySchema = z
  .string()
  .max(512)
  .refine(isSocialImageKey, "Upload the social image again.");