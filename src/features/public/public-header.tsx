import Image from "next/image";
import Link from "next/link";

import { ConsentSettingsButton } from "@/features/consent/consent-settings-button";
import { publicUnreadNotificationCount } from "@/features/notifications/inbox";
import { loadPortalNavigation } from "@/features/portal/service";

import { localeSwitchPath, PUBLIC_LOCALES, PUBLIC_SECTION_LABEL_KEYS } from "./i18n";
import { PublicDocumentLanguage } from "./public-document-language";
import { getPublicSite } from "./i18n/server";
import { NotificationBell } from "./notification-bell";
import { publicLoginPath, publicNotificationsPath } from "./paths";
import { ProfileMenu } from "./profile-menu";
import { getPublicViewer, type PublicViewerIdentity } from "./viewer";

/**
 * Shared header for the public surface.
 *
 * Branding and language come from the workspace, so the same header is used by
 * the board, request, submit and sign-in pages and always shows the workspace's
 * public identity. The language links set a cookie and return to this page.
 */
export async function PublicHeader({
  productName,
  workspaceSlug,
  productSlug,
  viewer,
  homeHref,
  nextPath,
}: {
  productName: string;
  workspaceSlug: string;
  productSlug: string;
  viewer: PublicViewerIdentity | null;
  homeHref: string;
  nextPath: string;
}) {
  const [site, unread, viewerSession] = await Promise.all([
    getPublicSite(workspaceSlug),
    viewer?.identified
      ? publicUnreadNotificationCount({ workspaceSlug, productSlug })
      : Promise.resolve(0),
    getPublicViewer(),
  ]);
  const navigation = await loadPortalNavigation({
    workspaceSlug,
    productSlug,
    viewerCustomerId: viewerSession?.customerId ?? null,
  });
  const { t, locale } = site;
  const showProductName =
    productName.trim().length > 0 && productName.trim() !== site.brandName.trim();

  const loginHref = `${publicLoginPath(workspaceSlug, productSlug)}?next=${encodeURIComponent(
    nextPath,
  )}`;

  return (
    <header className="border-b bg-card">
      <PublicDocumentLanguage locale={locale} />
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href={homeHref} className="flex min-w-0 items-center gap-2.5">
          {site.logoUrl ? (
            <Image
              src={site.logoUrl}
              alt=""
              width={32}
              height={32}
              unoptimized
              className="size-8 shrink-0 rounded object-contain"
            />
          ) : null}
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold tracking-tight text-foreground hover:text-primary">
              {site.brandName}
            </span>
            {showProductName ? (
              <span className="block truncate text-xs text-muted-foreground">{productName}</span>
            ) : null}
          </span>
        </Link>

        <div className="flex shrink-0 items-center gap-2">
          <nav
            aria-label={t("header.language")}
            className="flex items-center gap-1 text-xs font-medium"
          >
            {PUBLIC_LOCALES.map((code) => {
              const active = locale === code;
              const label = code === "en" ? t("header.english") : t("header.spanish");

              return (
                // A plain anchor, not `next/link`: the switch route stores a
                // cookie and redirects, and a client-side navigation reuses the
                // cached payload for this URL, so the page would keep rendering
                // the previous language until a manual reload.
                <a
                  key={code}
                  href={localeSwitchPath(code, nextPath)}
                  aria-current={active ? "true" : undefined}
                  aria-label={label}
                  title={label}
                  className={`inline-flex min-w-6 items-center justify-center rounded px-2 py-1.5 transition-colors ${
                    active
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {code.toUpperCase()}
                </a>
              );
            })}
          </nav>
          {viewer?.identified ? (
            <NotificationBell
              href={publicNotificationsPath(workspaceSlug, productSlug)}
              unread={unread}
            />
          ) : null}
          <ProfileMenu viewer={viewer} loginHref={loginHref} />
        </div>
      </div>
      {navigation ? (
        <div className="border-t border-border/60 bg-card">
          <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:px-6">
            <nav aria-label={t("nav.portal")} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium">
              <Link href={navigation.productPath} className="text-muted-foreground hover:text-foreground">
                {t("nav.home")}
              </Link>
              {navigation.sections.map((section) => (
                <Link
                  key={section.key}
                  href={section.href}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {t(PUBLIC_SECTION_LABEL_KEYS[section.key])}
                </Link>
              ))}
              <Link
                href={`${navigation.productPath}/support`}
                className="text-muted-foreground hover:text-foreground"
              >
                {t("nav.support")}
              </Link>
              <ConsentSettingsButton className="text-muted-foreground hover:text-foreground" />
            </nav>
            <form
              action={`${navigation.productPath}/search`}
              className="ms-auto flex min-w-48 flex-1 items-center gap-1.5 sm:max-w-xs"
            >
              <label htmlFor="portal-search" className="sr-only">
                {t("search.label")}
              </label>
              <input
                id="portal-search"
                name="q"
                type="search"
                placeholder={t("search.placeholder")}
                className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-xs"
              />
              <button className="h-8 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground">
                {t("search.submit")}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </header>
  );
}
