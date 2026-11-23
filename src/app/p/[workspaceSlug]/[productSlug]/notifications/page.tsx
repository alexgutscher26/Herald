import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { formatPublicDate } from "@/features/public/i18n";
import { getPublicSite } from "@/features/public/i18n/server";
import { MarkAllReadButton } from "@/features/public/mark-all-read-button";
import {
  publicLoginPath,
  publicNotificationsPath,
} from "@/features/public/paths";
import { PublicHeader } from "@/features/public/public-header";
import { getPublicViewerIdentity } from "@/features/public/viewer";
import { loadPublicInbox } from "@/features/notifications/inbox";

/**
 * In-app notification inbox.
 *
 * The header bell links here for signed-in customers. Everything is resolved
 * from the session cookie and the product in the URL; there is no customer id
 * in the path or query. Opening the inbox does not mark it read — the customer
 * chooses that explicitly, so a shared browser cannot quietly clear a badge.
 */

export const dynamic = "force-dynamic";

type Params = { workspaceSlug: string; productSlug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const resolved = await params;
  const site = await getPublicSite(resolved.workspaceSlug);
  return {
    title: site.t("notifications.title"),
    robots: { index: false, follow: false },
  };
}

export default async function NotificationsPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const resolved = await params;
  const [inbox, viewer, site] = await Promise.all([
    loadPublicInbox(resolved),
    getPublicViewerIdentity(resolved.workspaceSlug),
    getPublicSite(resolved.workspaceSlug),
  ]);

  if (inbox.state === "not_found") notFound();

  const { t, locale } = site;
  const path = publicNotificationsPath(resolved.workspaceSlug, resolved.productSlug);
  const loginHref = `${publicLoginPath(
    resolved.workspaceSlug,
    resolved.productSlug,
  )}?next=${encodeURIComponent(path)}`;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <PublicHeader
        productName={inbox.product.name}
        workspaceSlug={inbox.workspace.slug}
        productSlug={inbox.product.slug}
        viewer={viewer}
        homeHref={path}
        nextPath={path}
      />

      <main
        id="public-main"
        tabIndex={-1}
        className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6 sm:py-8"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
              {t("notifications.title")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("notifications.subtitle", { product: inbox.product.name })}
            </p>
          </div>
          {inbox.state === "ready" && inbox.unread > 0 ? (
            <MarkAllReadButton
              workspaceSlug={inbox.workspace.slug}
              productSlug={inbox.product.slug}
              unread={inbox.unread}
            />
          ) : null}
        </div>

        {inbox.state === "signed_out" ? (
          <div className="mt-8 rounded-lg border bg-card p-6">
            <h2 className="text-base font-semibold">
              {t("notifications.signInTitle")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("notifications.signInBody")}
            </p>
            <Link
              href={loginHref}
              className="mt-4 inline-flex text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              {t("common.signIn")}
            </Link>
          </div>
        ) : inbox.items.length === 0 ? (
          <div className="mt-8 rounded-lg border bg-card p-6">
            <h2 className="text-base font-semibold">
              {t("notifications.emptyTitle")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("notifications.emptyBody")}
            </p>
          </div>
        ) : (
          <ul className="mt-6 space-y-3" aria-label={t("notifications.listLabel")}>
            {inbox.items.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="block rounded-lg border bg-card p-4 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 size-2 shrink-0 rounded-full ${
                        item.read ? "bg-transparent" : "bg-primary"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-medium text-foreground">
                        {item.read ? null : (
                          <span className="sr-only">
                            {t("notifications.unreadLabel")}{" "}
                          </span>
                        )}
                        {item.title}
                      </p>
                      <p className="mt-0.5 break-words text-sm leading-relaxed text-muted-foreground">
                        {item.body}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {t("notifications.received", {
                          date: formatPublicDate(locale, item.createdAt),
                        })}
                      </p>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
