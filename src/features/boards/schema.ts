import { z } from "zod";

import { slugify, validateSlug } from "@/lib/slug";

/**
 * Board form contract.
 *
 * Pure and shared by the server action and its tests. The public URL is a slug
 * on the same rules as workspace/product slugs, so a board can never contain a
 * character that would break `/p/{workspace}/{product}/{board}`.
 */

export const BOARD_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
export const BOARD_MAX_DESCRIPTION = 280;

export const boardFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Give the board a name of at least two characters.")
    .max(80, "Keep the board name under 80 characters."),
  slug: z
    .string()
    .trim()
    .max(48, "Keep the public URL under 48 characters.")
    .default(""),
  description: z
    .string()
    .trim()
    .max(BOARD_MAX_DESCRIPTION, "Keep the description under 280 characters.")
    .default(""),
  icon: z.string().trim().max(8, "Use a short icon, such as an emoji.").default(""),
  color: z
    .string()
    .trim()
    .default("")
    .refine((value) => value === "" || BOARD_COLOR_PATTERN.test(value), {
      message: "Colour must be a six-digit hex value such as #4f46e5.",
    }),
  position: z.coerce
    .number()
    .int("Position must be a whole number.")
    .min(0, "Position cannot be negative.")
    .max(9_999, "Position is too large.")
    .default(0),
  visibility: z.enum(["public", "private"]).default("public"),
  guestPosting: z.boolean().default(false),
  requireApproval: z.enum(["none", "first_time", "all"]).default("none"),
  comments: z.enum(["open", "moderated", "closed"]).default("open"),
  blockSensitiveInfo: z.boolean().default(false),
});

export type BoardFormInput = z.input<typeof boardFormSchema>;
export type BoardFormValues = z.output<typeof boardFormSchema>;

export type BoardSlugResolution =
  | { ok: true; slug: string }
  | { ok: false; reason: string };

/**
 * Resolve the public URL segment from the form.
 *
 * A blank field derives the slug from the name (create flow); a supplied value
 * is validated as-is rather than silently rewritten, so the operator sees why
 * their URL was rejected.
 */
export function resolveBoardSlug(input: {
  slug: string;
  name: string;
}): BoardSlugResolution {
  const supplied = input.slug.trim();
  const candidate = supplied === "" ? slugify(input.name) : supplied;

  if (candidate === "") {
    return {
      ok: false,
      reason: "That name has no URL-safe characters; enter a public URL manually.",
    };
  }

  const validation = validateSlug(candidate);
  if (!validation.ok) return validation;
  return { ok: true, slug: validation.slug };
}

/** First field error, for an inline message in the dialog. */
export function firstBoardIssue(error: z.ZodError): {
  message: string;
  fieldErrors: Record<string, string[]>;
} {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
  }

  return {
    message: error.issues[0]?.message ?? "Check the board details.",
    fieldErrors,
  };
}
