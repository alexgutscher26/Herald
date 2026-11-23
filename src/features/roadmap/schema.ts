import { z } from "zod";

import { slugify, validateSlug } from "@/lib/slug";

/**
 * Public roadmap form contract.
 *
 * A roadmap never stores statuses. It selects public boards and a visibility;
 * the page projects `feedback_posts.status` underneath those boards.
 */

export const ROADMAP_VISIBILITIES = ["public", "unlisted"] as const;
export type RoadmapVisibility = (typeof ROADMAP_VISIBILITIES)[number];

export const ROADMAP_MAX_DESCRIPTION = 280;

export const roadmapFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Give the roadmap a name of at least two characters.")
    .max(80, "Keep the roadmap name under 80 characters."),
  slug: z
    .string()
    .trim()
    .max(48, "Keep the public URL under 48 characters.")
    .default(""),
  description: z
    .string()
    .trim()
    .max(ROADMAP_MAX_DESCRIPTION, "Keep the description under 280 characters.")
    .default(""),
  visibility: z.enum(ROADMAP_VISIBILITIES).default("public"),
  position: z.coerce
    .number()
    .int("Position must be a whole number.")
    .min(0, "Position cannot be negative.")
    .max(9_999, "Position is too large.")
    .default(0),
  boardIds: z
    .array(z.uuid("Choose valid boards."))
    .max(25, "A roadmap can include at most 25 boards.")
    .default([]),
  published: z.boolean().default(false),
});

export type RoadmapFormInput = z.input<typeof roadmapFormSchema>;
export type RoadmapFormValues = z.output<typeof roadmapFormSchema>;

export type RoadmapSlugResolution =
  | { ok: true; slug: string }
  | { ok: false; reason: string };

/** Derive a blank slug from the name; reject a supplied invalid one. */
export function resolveRoadmapSlug(input: {
  slug: string;
  name: string;
}): RoadmapSlugResolution {
  const supplied = input.slug.trim();
  const candidate = supplied === "" ? slugify(input.name) : supplied;

  if (candidate === "") {
    return {
      ok: false,
      reason: "That name has no URL-safe characters; enter a public URL manually.",
    };
  }

  return validateSlug(candidate);
}

/** First field error, for an inline message in the manager. */
export function firstRoadmapIssue(error: z.ZodError): {
  message: string;
  fieldErrors: Record<string, string[]>;
} {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
  }

  return {
    message: error.issues[0]?.message ?? "Check the roadmap details.",
    fieldErrors,
  };
}
