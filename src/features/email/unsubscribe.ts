import type { NotificationTemplate } from "@/db/schema/notifications";

/** RFC 8058 one-click unsubscribe headers for marketing-class email. */

export const ONE_CLICK_UNSUBSCRIBE_PATH = "/api/public/email-preferences/unsubscribe";

export function oneClickUnsubscribeUrl(origin: string, token: string): string {
  const url = new URL(ONE_CLICK_UNSUBSCRIBE_PATH, origin);
  url.searchParams.set("token", token);
  return url.toString();
}

export function isMarketingTemplate(template: NotificationTemplate): boolean {
  return (
    template === "release_published" ||
    template === "weekly_digest" ||
    template === "daily_digest" ||
    template === "winback_campaign" ||
    template === "outbound_message"
  );
}

export function listUnsubscribeHeaders(
  origin: string,
  token: string,
): Record<string, string> {
  return {
    "List-Unsubscribe": `<${oneClickUnsubscribeUrl(origin, token)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
