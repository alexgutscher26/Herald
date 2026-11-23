import { z } from "zod";

import { validateSlug } from "@/lib/slug";

import { isCustomCoverKey } from "./cover";
import { socialImageKeySchema } from "./social-image";

import {
  MAX_RELEASE_TAGS,
  MAX_RELEASE_TAG_LENGTH,
  parseReleaseTagText,
} from "./tags";
import { youTubeVideoId } from "./youtube";

export const releaseTranslationsSchema = z
  .object({
    es: z
      .object({
        title: z.string().trim().max(120),
        summary: z.string().trim().max(280),
        body: z.string().max(200_000),
      })
      .optional(),
  })
  .optional();

const coverSchema = z.union([
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("preset"), preset: z.enum(["grid", "orbit", "waves", "plain"]) }),
  z.object({
    kind: z.literal("custom"),
    key: z
      .string()
      .max(512)
      .refine(isCustomCoverKey, "Upload the cover image again."),
    /** Signed preview URL returned by the upload route; never persisted. */
    url: z.string().max(2048).nullable().optional(),
  }),
]);

export const releaseFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, "Give the release a title of at least 3 characters.")
    .max(120, "Keep the title under 120 characters."),
  slug: z.string().trim().superRefine((value, context) => {
    const result = validateSlug(value);
    if (!result.ok) context.addIssue({ code: "custom", message: result.reason });
  }),
  summary: z
    .string()
    .trim()
    .min(10, "Write a one-sentence summary of at least 10 characters.")
    .max(280, "Keep the summary under 280 characters."),
  body: z.string().min(20, "The changelog body needs at least 20 characters."),
  translations: releaseTranslationsSchema,
  category: z.enum(["feature", "improvement", "fix"]),
  tagsText: z.string().max(400, "Keep the tag list under 400 characters.").superRefine((value, context) => {
    const tags = parseReleaseTagText(value);
    if (tags.length > MAX_RELEASE_TAGS) {
      context.addIssue({
        code: "custom",
        message: `Use at most ${MAX_RELEASE_TAGS} tags.`,
      });
    }
    if (tags.some((tag) => tag.length > MAX_RELEASE_TAG_LENGTH)) {
      context.addIssue({
        code: "custom",
        message: `Keep each tag under ${MAX_RELEASE_TAG_LENGTH} characters.`,
      });
    }
  }),
  authorIds: z.array(z.string()).min(1, "Choose at least one author."),
  youtubeUrl: z
    .string()
    .trim()
    .max(500, "That YouTube link is too long.")
    .refine(
      (value) => value === "" || youTubeVideoId(value) !== null,
      "Use a YouTube watch, share, shorts or embed link.",
    ),
  cover: coverSchema,
  ogImage: z
    .object({
      key: socialImageKeySchema,
      url: z.string().max(2048).nullable().optional(),
    })
    .nullable(),
  channels: z
    .object({
      publicChangelog: z.boolean(),
      inAppWidget: z.boolean(),
      subscriberEmail: z.boolean(),
    })
    .refine(
      (channels) => channels.publicChangelog || channels.inAppWidget || channels.subscriberEmail,
      { message: "Choose at least one distribution channel." },
    ),
  linkedFeedbackIds: z.array(z.string()),
  linkedCancellationReasonIds: z.array(z.string()),
  publishMode: z.enum(["now", "schedule"]),
  scheduledFor: z.string(),
});

export type ReleaseFormValues = z.infer<typeof releaseFormSchema>;
