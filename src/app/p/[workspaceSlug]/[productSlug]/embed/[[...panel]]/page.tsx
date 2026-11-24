import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { foregroundFor } from "@/features/branding/schema";
import { loadPublicInbox } from "@/features/notifications/inbox";
import { trackPublicView } from "@/features/analytics/track";
import { getPublicChangelogEntry, getPublicChangelogPage } from "@/features/public/changelog";
import { getPublicHelpIndex } from "@/features/help/service";
import { createTranslator } from "@/features/public/i18n";
import { PublicI18nProvider } from "@/features/public/i18n/provider";
import { getPublicSite } from "@/features/public/i18n/server";
import { parsePublicBoardQuery } from "@/features/public/query";
import { getPublicBoardPage, getPublicRequestPage, getPublicSubmitPage } from "@/features/public/queries";
import { getPublicRoadmapPage } from "@/features/public/roadmap";
import { getPublicViewer } from "@/features/public/viewer";
import { WidgetFrameBridge } from "@/features/widget/frame-bridge";
import {
  resolveWidgetOriginOverride,
  type WidgetSection,
} from "@/features/widget/policy";
import {
  parseWidgetHostOrigin,
  parseWidgetLocale,
  parseWidgetPanel,
  parseWidgetSections,
  parseWidgetTheme,
  widgetPanelSegments,
  type WidgetQuery,
} from "@/features/widget/paths";
import {
  WidgetComposePanel,
  WidgetFeedbackPanel,
  WidgetMessagesPanel,
  WidgetNotificationsPanel,
  WidgetRequestPanel,
  WidgetRoadmapPanel,
  WidgetUpdatePanel,
  WidgetUpdatesPanel,
  WidgetWhatsNewPanel,
} from "@/features/widget/panels";
import { WidgetHelpPanel } from "@/features/widget/help-panel";
import { loadWidgetShell, widgetBoardSlug } from "@/features/widget/service";
import { readWidgetSettings } from "@/features/widget/settings";
import { WidgetChrome } from "@/features/widget/shell";

/**
 * Embeddable widget surface.
 *
 * A single iframe route renders every panel. Panel state is real routing, not a
 * query-only client switch, so a deep link to a request or update survives a
 * reload. All data comes from the public projections; the session is the same
 * first-party customer cookie used by the full site.
 */

export const dynamic = "force-dynamic";

type Params = { workspaceSlug: string; productSlug: string; panel?: string[] };
type Search = {
  theme?: string;
  locale?: string;
  host?: string;
  key?: string;
  submitted?: string;
  page?: string;
  sort?: string;
  status?: string;
  tag?: string;
  q?: string;
  sections?: string;
  preview?: string;
};

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Updates",
    robots: { index: false, follow: false },
  };
}

function first(value: string | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function WidgetEmbedPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Search>;
}) {
  const resolved = await params;
  const search = await searchParams;
  const route = parseWidgetPanel(resolved.panel);
  if (!route) notFound();

  const hostOrigin = parseWidgetHostOrigin(first(search.host));
  const projectKey = first(search.key)?.trim() ?? null;
  const requestedPreview = first(search.preview)?.trim() ?? null;
  const shell = await loadWidgetShell({
    workspaceSlug: resolved.workspaceSlug,
    productSlug: resolved.productSlug,
    projectKey,
    hostOrigin,
    previewToken: requestedPreview,
  });
  if (!shell) notFound();

  // The installation origin may have its own launcher position/theme. The
  // loader applies this after the frame reports it, so the host needs no
  // extra request and the snippet stays a single tag.
  const widgetSettings = await readWidgetSettings(shell.workspace.id);
  const originOverride = resolveWidgetOriginOverride(
    widgetSettings?.originOverrides ?? [],
    hostOrigin,
  );

  const previewToken = shell.preview ? requestedPreview : null;
  if (!previewToken) {
    await trackPublicView({
      workspaceId: shell.workspace.id,
      productId: shell.product.id,
      type: "widget_open",
      metadata: { panel: route.view },
    });
  }

  const [site, viewer] = await Promise.all([
    getPublicSite(shell.workspace.slug),
    getPublicViewer(),
  ]);

  const requestedTheme = parseWidgetTheme(first(search.theme));
  const requestedLocale = parseWidgetLocale(first(search.locale));
  const locale = requestedLocale ?? site.locale;
  const theme = requestedTheme ?? originOverride?.theme ?? site.theme;
  const launcherPosition =
    originOverride?.position ?? widgetSettings?.position ?? "bottom-right";
  const t = createTranslator(locale).t;

  // Saved widget settings are authoritative for the optional panels. The
  // tag's data-sections is only a fallback when no settings row exists, so a
  // customizer change also reaches installations carrying an older script.
  const requestedSections = parseWidgetSections(first(search.sections));
  const availableSections = (["feedback", "roadmap", "help", "messages"] as const).filter(
    (section) => shell.panels[section],
  );
  const panelSections =
    widgetSettings?.sections ?? requestedSections ?? availableSections;
  const sections: WidgetSection[] = panelSections.filter((section) =>
    availableSections.includes(section),
  );

  const widgetQuery: WidgetQuery = {
    theme: requestedTheme,
    locale: requestedLocale,
    host: hostOrigin,
    key: projectKey,
    sections,
  };
  const submitted =
    first(search.submitted) === "published"
      ? "published"
      : first(search.submitted) === "awaiting_review"
        ? "awaiting_review"
        : null;

  const boardSlug =
    route.view === "feedback"
      ? await widgetBoardSlug(shell, route.boardSlug)
      : null;

  let content: ReactNode;

  switch (route.view) {
    case "home": {
      const updates = shell.panels.updates
        ? await getPublicChangelogPage({
            workspaceSlug: shell.workspace.slug,
            productSlug: shell.product.slug,
            pageSize: 20,
          })
        : null;
      content = (
        <WidgetWhatsNewPanel
          shell={shell}
          page={updates}
          accentColor={site.primaryColor || "#1f6b45"}
          accentForeground={foregroundFor(site.primaryColor || "#1f6b45")}
          t={t}
          locale={locale}
          translationEnabled={site.contentTranslationEnabled}
          sections={sections}
          query={widgetQuery}
        />
      );
      break;
    }

    case "feedback": {
      if (route.requestId) {
        if (!boardSlug) notFound();
        const page = await getPublicRequestPage(
          {
            workspaceSlug: shell.workspace.slug,
            productSlug: shell.product.slug,
            boardSlug,
            requestId: route.requestId,
          },
          viewer,
        );
        if (!page) notFound();
        content = (
          <WidgetRequestPanel
            shell={shell}
            page={page}
            t={t}
            locale={locale}
            query={widgetQuery}
            submitted={submitted}
          />
        );
        break;
      }

      if (route.compose) {
        if (!boardSlug) notFound();
        const page = await getPublicSubmitPage(
          {
            workspaceSlug: shell.workspace.slug,
            productSlug: shell.product.slug,
            boardSlug,
          },
          viewer,
        );
        content = (
          <WidgetComposePanel
            shell={shell}
            page={page}
            t={t}
            query={widgetQuery}
            hostOrigin={hostOrigin}
          />
        );
        break;
      }

      const page = boardSlug
        ? await getPublicBoardPage(
            {
              workspaceSlug: shell.workspace.slug,
              productSlug: shell.product.slug,
              boardSlug,
            },
            parsePublicBoardQuery({
              page: first(search.page),
              sort: first(search.sort),
              status: first(search.status),
              tag: first(search.tag),
              q: first(search.q),
              pageSize: "50",
            }),
          )
        : null;
      content = (
        <WidgetFeedbackPanel
          shell={shell}
          page={page}
          t={t}
          locale={locale}
          query={widgetQuery}
        />
      );
      break;
    }

    case "roadmap": {
      const page = shell.panels.roadmap
        ? await getPublicRoadmapPage({
            workspaceSlug: shell.workspace.slug,
            productSlug: shell.product.slug,
          })
        : null;
      content = (
        <WidgetRoadmapPanel
          shell={shell}
          page={page}
          t={t}
          query={widgetQuery}
        />
      );
      break;
    }

    case "updates": {
      if (route.slug) {
        const page = shell.panels.updates
          ? await getPublicChangelogEntry(
              {
                workspaceSlug: shell.workspace.slug,
                productSlug: shell.product.slug,
                slug: route.slug,
              },
              viewer,
            )
          : null;
        if (!page) notFound();
        content = (
          <WidgetUpdatePanel
            shell={shell}
            page={page}
            t={t}
            locale={locale}
            translationEnabled={site.contentTranslationEnabled}
            query={widgetQuery}
          />
        );
        break;
      }

      const page = shell.panels.updates
        ? await getPublicChangelogPage({
            workspaceSlug: shell.workspace.slug,
            productSlug: shell.product.slug,
          })
        : null;
      content = (
        <WidgetUpdatesPanel
          shell={shell}
          page={page}
          t={t}
          locale={locale}
          translationEnabled={site.contentTranslationEnabled}
          query={widgetQuery}
        />
      );
      break;
    }

    case "help": {
      const help = shell.panels.help
        ? await getPublicHelpIndex({
            workspaceSlug: shell.workspace.slug,
            productSlug: shell.product.slug,
            locale,
          })
        : null;
      content = (
        <WidgetHelpPanel
          help={help}
          workspaceSlug={shell.workspace.slug}
          productSlug={shell.product.slug}
          t={t}
        />
      );
      break;
    }

    case "messages":
      content = (
        <WidgetMessagesPanel
          shell={shell}
          query={widgetQuery}
          hostOrigin={hostOrigin}
        />
      );
      break;

    case "notifications": {
      const inbox = await loadPublicInbox({
        workspaceSlug: shell.workspace.slug,
        productSlug: shell.product.slug,
      });
      content = (
        <WidgetNotificationsPanel
          shell={shell}
          inbox={inbox}
          t={t}
          locale={locale}
          query={widgetQuery}
        />
      );
      break;
    }
  }

  return (
    <PublicI18nProvider locale={locale}>
      <div
        lang={locale}
        className={`public-theme-${theme} flex h-[100dvh] flex-col overflow-hidden bg-background text-foreground`}
      >
        <WidgetFrameBridge
          hostOrigin={hostOrigin}
          workspaceSlug={shell.workspace.slug}
          productSlug={shell.product.slug}
          panelPath={widgetPanelSegments(route).join("/")}
          unread={shell.unread}
          online={shell.presence.online}
          identified={Boolean(shell.viewer?.identified)}
          accentColor={site.primaryColor || "#1f6b45"}
          accentForeground={foregroundFor(site.primaryColor || "#1f6b45")}
          theme={theme}
          position={launcherPosition}
          previewToken={previewToken}
        />
        <WidgetChrome
          shell={shell}
          accentColor={site.primaryColor || "#1f6b45"}
          accentForeground={foregroundFor(site.primaryColor || "#1f6b45")}
          locale={locale}
          t={t}
          active={route.view}
          routeKey={widgetPanelSegments(route).join("/") || "home"}
          query={widgetQuery}
          hostOrigin={hostOrigin}
          sections={sections}
          hideAttribution={site.hideAttribution}
          focused={route.view === "feedback" && route.compose === true}
        >
          {content}
        </WidgetChrome>
      </div>
    </PublicI18nProvider>
  );
}
