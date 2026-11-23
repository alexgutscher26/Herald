import { z } from "zod";

import {
  PRODUCT_DESCRIPTION_MAX,
  PRODUCT_DESCRIPTION_MIN,
} from "./constants";

/**
 * Product copy contract.
 *
 * The description doubles as the product's public one-liner, so it stays short
 * enough for page headers and metadata. An empty value is allowed to clear the
 * description; anything non-empty must clear the setup checklist's threshold.
 */

export const productDetailsSchema = z.object({
  workspaceSlug: z.string().min(1),
  productSlug: z.string().min(1),
  description: z
    .string()
    .trim()
    .max(
      PRODUCT_DESCRIPTION_MAX,
      `Keep the description under ${PRODUCT_DESCRIPTION_MAX} characters.`,
    )
    .refine(
      (value) => value === "" || value.length >= PRODUCT_DESCRIPTION_MIN,
      `Use at least ${PRODUCT_DESCRIPTION_MIN} characters, or leave it blank.`,
    ),
});
