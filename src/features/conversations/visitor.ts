import type { ConversationSourceContext } from "@/db/schema/conversations";

/**
 * Visitor context captured at thread start.
 *
 * Everything here is optional and bounded. Only http(s) referrers are kept, no
 * IP address is stored, and the user agent is truncated rather than persisted
 * in full. This is context for an operator, not an analytics identity.
 */

export function normalizeSourceUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString().slice(0, 2048);
  } catch {
    return null;
  }
}

export function normalizeTimezone(value: string | null | undefined): string | null {
  const timezone = value?.trim() ?? "";
  if (timezone === "" || timezone.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
    return timezone;
  } catch {
    return null;
  }
}

export function buildWidgetSourceContext(input: {
  sourceUrl?: string | null | undefined;
  locale?: string | null | undefined;
  timezone?: string | null | undefined;
  userAgent?: string | null | undefined;
}): ConversationSourceContext {
  const referrer = normalizeSourceUrl(input.sourceUrl);
  const timezone = normalizeTimezone(input.timezone);
  const locale = input.locale?.trim().slice(0, 120) || undefined;
  const userAgent = input.userAgent?.trim().slice(0, 500) || undefined;

  return {
    channel: "widget",
    ...(referrer ? { referrer } : {}),
    ...(locale ? { locale } : {}),
    ...(timezone ? { timezone } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}
