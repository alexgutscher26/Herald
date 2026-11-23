import { z } from "zod";

import { slugify } from "@/lib/slug";

/**
 * Subscription topic definitions.
 *
 * `product_updates` and `winback` deliberately map onto the existing subscriber
 * columns, so every delivery path keeps working. Additional topics are stored
 * in `subscription_topics` and default to off.
 */

export type DefaultTopic = {
  key: string;
  name: string;
  description: string;
  position: number;
};

export type TopicPreferenceView = {
  key: string;
  name: string;
  description: string | null;
  subscribed: boolean;
  builtIn: boolean;
  /** A release tag topic, managed by the releases that use the tag. */
  tag: boolean;
};

export const PRODUCT_UPDATES_TOPIC = "product_updates";
export const WINBACK_TOPIC = "winback";

export const DEFAULT_SUBSCRIPTION_TOPICS: readonly DefaultTopic[] = [
  {
    key: PRODUCT_UPDATES_TOPIC,
    name: "Product updates",
    description: "Changelog entries and product announcements.",
    position: 0,
  },
  {
    key: WINBACK_TOPIC,
    name: "Win-back messages",
    description: "Occasional messages when something you cancelled has shipped.",
    position: 1,
  },
];

export const TOPIC_KEY_PATTERN = /^[a-z][a-z0-9_]{1,31}$/;
export const RELEASE_TAG_TOPIC_PREFIX = "tag_";

/** Stable per-tag topic key, kept inside the 32-character topic key limit. */
export function releaseTagTopicKey(slug: string): string {
  const clean = slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const key = `${RELEASE_TAG_TOPIC_PREFIX}${clean || "tag"}`;
  if (key.length <= 32) return key;

  let hash = 0;
  for (const character of slug) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return `${key.slice(0, 27)}_${hash.toString(36).slice(0, 4)}`;
}

export function isReleaseTagTopicKey(key: string): boolean {
  return key.startsWith(RELEASE_TAG_TOPIC_PREFIX);
}

export function isSubscriptionTopicKey(value: unknown): value is string {
  return typeof value === "string" && TOPIC_KEY_PATTERN.test(value);
}

/** Turn a display name into a stable topic key. */
export function normalizeTopicKey(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);

  if (normalized === "" || !/^[a-z]/.test(normalized)) {
    const fallback = slugify(value).replaceAll("-", "_");
    return /^[a-z]/.test(fallback) ? fallback : "";
  }
  return normalized;
}

export const topicFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Give the topic a name of at least two characters.")
    .max(80, "Keep the topic name under 80 characters."),
  key: z.string().trim().max(32).default(""),
  description: z
    .string()
    .trim()
    .max(280, "Keep the description under 280 characters.")
    .default(""),
  position: z.coerce
    .number()
    .int("Position must be a whole number.")
    .min(0, "Position cannot be negative.")
    .max(9_999, "Position is too large.")
    .default(0),
  active: z.boolean().default(true),
});

export type TopicFormInput = z.input<typeof topicFormSchema>;
export type TopicFormValues = z.output<typeof topicFormSchema>;

export function firstTopicIssue(error: z.ZodError): {
  message: string;
  fieldErrors: Record<string, string[]>;
} {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
  }

  return {
    message: error.issues[0]?.message ?? "Check the topic details.",
    fieldErrors,
  };
}
