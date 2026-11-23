import { z } from "zod";

import { validateSlug } from "@/lib/slug";

import { coverInputSchema as coverSchema } from "./cover";
import { releaseTranslationsSchema } from "./release-schema";
import { socialImageKeySchema } from "./social-image";
import { MAX_RELEASE_TAG_LENGTH, MAX_RELEASE_TAGS } from "./tags";
import { youTubeVideoId } from "./youtube";

const slugSchema = z.string().superRefine((value, context) => {
  const result = validateSlug(value);
  if (!result.ok) context.addIssue({ code: "custom", message: result.reason });
});

const channelsSchema = z
  .object({
    publicChangelog: z.boolean(),
    inAppWidget: z.boolean(),
    subscriberEmail: z.boolean(),
  })
  .refine(
    (channels) =>
      channels.publicChangelog || channels.inAppWidget || channels.subscriberEmail,
    { message: "Choose at least one distribution channel." },
  );

const draftFields = {
  summary: z.string().trim().max(280, "Keep the summary under 280 characters.").optional(),
  body: z.string().max(200_000, "That body is too large.").optional(),
  translations: releaseTranslationsSchema,
  category: z.enum(["feature", "improvement", "fix"]).optional(),
  tags: z
    .array(z.string().trim().min(1).max(MAX_RELEASE_TAG_LENGTH))
    .max(MAX_RELEASE_TAGS)
    .optional(),
  authorIds: z.array(z.string().min(1)).min(1).max(20).optional(),
  youtubeUrl: z
    .string()
    .trim()
    .max(500)
    .refine(
      (value) => value === "" || youTubeVideoId(value) !== null,
      "Use a YouTube watch, share, shorts or embed link.",
    )
    .nullable()
    .optional(),
  cover: coverSchema.optional(),
  ogImageKey: socialImageKeySchema.nullable().optional(),
  channels: channelsSchema.optional(),
  linkedFeedbackIds: z.array(z.uuid()).max(200).optional(),
  linkedCancellationReasonIds: z.array(z.uuid()).max(200).optional(),
};

/**
 * Draft write contracts.
 *
 * The API deliberately has no `status`, `publishedAt`, `scheduledFor` or
 * `destination` field. A caller cannot publish, schedule, archive or backdate a
 * release through this surface; publishing stays in the editor action.
 */

export const releaseDraftCreateSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, "Give the release a title of at least 3 characters.")
    .max(120, "Keep the title under 120 characters."),
  slug: slugSchema,
  ...draftFields,
});

export const releaseDraftUpdateSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, "Give the release a title of at least 3 characters.")
    .max(120, "Keep the title under 120 characters.")
    .optional(),
  slug: slugSchema.optional(),
  ...draftFields,
});

export type ReleaseDraftCreateInput = z.infer<typeof releaseDraftCreateSchema>;
export type ReleaseDraftUpdateInput = z.infer<typeof releaseDraftUpdateSchema>;
