"use client";

import { Bell } from "lucide-react";
import Link from "next/link";

import { usePublicI18n } from "./i18n/provider";

/**
 * Unread notifications link for the public header.
 *
 * The count is rendered by the server; this component only presents it. The
 * inbox itself re-checks the session, so a forged count reveals nothing.
 */
export function NotificationBell({
  href,
  unread,
}: {
  href: string;
  unread: number;
}) {
  const { t } = usePublicI18n();
  const label =
    unread > 0
      ? t("notifications.bellWithUnread", { count: unread })
      : t("notifications.bell");

  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className="relative inline-flex size-9 items-center justify-center rounded-full border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Bell className="size-4" aria-hidden="true" />
      {unread > 0 ? (
        <span
          aria-hidden="true"
          className="absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
