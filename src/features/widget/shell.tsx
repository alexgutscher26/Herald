import { Bell, Rocket } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import type { PublicLocaleCode, Translate } from "@/features/public/i18n";

import { WidgetCloseButton } from "./frame-bridge";
import type { WidgetSection } from "./policy";
import {
  widgetEmbedHref,
  type WidgetPanelName,
  type WidgetQuery,
  type WidgetRoute,
} from "./paths";
import type { WidgetShell } from "./service";

/**
 * Chrome for the non-changelog panels.
 *
 * The header and the section nav match the What's new panel, so moving from
 * the changelog to feedback or the roadmap keeps the same widget identity.
 * Changelog and notifications stay reachable as compact icon links instead of
 * widening the row until labels are clipped.
 */

export function WidgetSectionNav({
  shell,
  active,
  sections,
  query,
  t,
}: {
  shell: WidgetShell;
  active: WidgetPanelName;
  sections: WidgetSection[];
  query: WidgetQuery;
  t: Translate;
}) {
  const items: { key: WidgetPanelName; label: string; route: WidgetRoute }[] = [
    { key: "home", label: t("widget.whatsNew"), route: { view: "home" } },
  ];

  if (sections.includes("feedback") && shell.panels.feedback) {
    items.push({
      key: "feedback",
      label: t("widget.feedback"),
      route: { view: "feedback", boardSlug: null },
    });
  }
  if (sections.includes("roadmap") && shell.panels.roadmap) {
    items.push({
      key: "roadmap",
      label: t("roadmap.nav"),
      route: { view: "roadmap" },
    });
  }
  if (sections.includes("help") && shell.panels.help) {
    items.push({
      key: "help",
      label: "Help",
      route: { view: "help" },
    });
  }
  if (sections.includes("messages")) {
    items.push({
      key: "messages",
      label: t("widget.messages"),
      route: { view: "messages" },
    });
  }

  if (items.length <= 1) return null;

  return (
    <nav
      aria-label={t("widget.nav")}
      className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border/70 bg-card px-3 py-1.5 [scrollbar-width:none]"
    >
      {items.map((item) => {
        const current = item.key === (active === "updates" ? "home" : active);
        return (
          <Link
            key={item.key}
            href={widgetEmbedHref(
              shell.workspace.slug,
              shell.product.slug,
              item.route,
              query,
            )}
            aria-current={current ? "page" : undefined}
            className={`inline-flex shrink-0 items-center rounded-md px-2 py-1 text-[10.5px] font-medium transition-colors ${
              current
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {item.label}
          </Link>
        );
      })}

      <span className="ml-auto flex shrink-0 items-center gap-1 pl-2">
        {shell.panels.updates ? (
          <Link
            href={widgetEmbedHref(
              shell.workspace.slug,
              shell.product.slug,
              { view: "updates", slug: null },
              query,
            )}
            aria-label={t("updates.nav")}
            aria-current={active === "updates" ? "page" : undefined}
            className={`inline-flex size-6 items-center justify-center rounded-md transition-colors ${
              active === "updates"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Rocket className="size-3.5" aria-hidden="true" />
          </Link>
        ) : null}
        <Link
          href={widgetEmbedHref(
            shell.workspace.slug,
            shell.product.slug,
            { view: "notifications" },
            query,
          )}
          aria-label={t("notifications.title")}
          aria-current={active === "notifications" ? "page" : undefined}
          className={`inline-flex size-6 items-center justify-center rounded-md transition-colors ${
            active === "notifications"
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <Bell className="size-3.5" aria-hidden="true" />
        </Link>
      </span>
    </nav>
  );
}

export function WidgetChrome({
  shell,
  accentColor,
  locale,
  t,
  active,
  query,
  hostOrigin,
  sections,
  children,
}: {
  shell: WidgetShell;
  accentColor: string;
  locale: PublicLocaleCode;
  t: Translate;
  active: WidgetPanelName;
  query: WidgetQuery;
  hostOrigin: string | null;
  sections: WidgetSection[];
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-start justify-between gap-2 border-b border-border/70 bg-card px-4 py-3">
        <div className="flex min-w-0 items-start gap-2">
          <span
            className="mt-1.5 size-2 shrink-0 rounded-full"
            style={{ backgroundColor: accentColor }}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold leading-tight">
              {t("widget.homeTitle", { product: shell.product.name })}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {shell.product.description?.trim() || t("widget.subtitle")}
            </p>
          </div>
        </div>
        <WidgetCloseButton hostOrigin={hostOrigin} label={t("widget.close")} />
      </header>

      <WidgetSectionNav
        shell={shell}
        active={active}
        sections={sections}
        query={query}
        t={t}
      />

      <main
        id="public-main"
        tabIndex={-1}
        lang={locale}
        className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4"
      >
        {children}
      </main>
    </div>
  );
}

export function WidgetEmpty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed bg-card p-5 text-center">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        {body}
      </p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
