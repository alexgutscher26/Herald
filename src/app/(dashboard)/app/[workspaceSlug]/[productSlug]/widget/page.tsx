import {
  Activity,
  Bell,
  ChevronDown,
  Clock3,
  Code2,
  Globe2,
} from "lucide-react";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { getWorkspaceBranding } from "@/features/branding/branding";
import { foregroundFor } from "@/features/branding/schema";
import { getIdentitySettings } from "@/features/customer-auth/identity-settings";
import { isFeatureEnabled } from "@/features/entitlements/flags";
import { getPublicChangelogPage } from "@/features/public/changelog";
import { publicOrigin } from "@/features/public/urls";
import { readWidgetHealth } from "@/features/widget/health";
import { widgetEmbedPath } from "@/features/widget/paths";
import { ensureWidgetSettings } from "@/features/widget/settings";
import { WidgetSettingsView } from "@/features/widget/settings-view";
import { resolveProductPage } from "@/lib/product-page";
import { hasPermission } from "@/lib/permissions";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "Widget",
};

/**
 * Widget installation and its per-workspace configuration.
 *
 * The snippet carries the installation key and the saved launcher defaults;
 * the embed route independently enforces both before rendering a panel. The
 * public product identity, branding and locale still resolve server-side, so
 * the snippet stays a single async tag with no inline JavaScript.
 */

function formatPreviewDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-[#2f2c28] bg-[#1c1b19] p-3 font-mono text-[10.5px] leading-relaxed text-[#f4f3ee]">
      <code>{children}</code>
    </pre>
  );
}

function ReferenceSection({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <details className="group border-b border-border/70 last:border-b-0">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-5 py-4 transition-colors hover:bg-muted/25 [&::-webkit-details-marker]:hidden">
        <div>
          <p className="text-[13px] font-semibold text-foreground">{title}</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>
        <ChevronDown
          className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="space-y-3 px-5 pb-5 pt-1 text-[12px] leading-relaxed text-muted-foreground">
        {children}
      </div>
    </details>
  );
}

export default async function WidgetPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string }>;
}) {
    const { workspaceSlug, productSlug, context } = await resolveProductPage(params, "widget:manage");

  const [settings, identity, branding, changelog, health] = await Promise.all([
    ensureWidgetSettings(context.workspace.id),
    getIdentitySettings(context.workspace.id, context.workspace.slug),
    getWorkspaceBranding(context.workspace.id),
    getPublicChangelogPage({
      workspaceSlug,
      productSlug,
      pageSize: 2,
    }),
    readWidgetHealth({
      workspaceId: context.workspace.id,
      productId: context.product.id,
    }),
  ]);
  const canManage = hasPermission(context.role, "widget:manage");
  const widgetEnabled = isFeatureEnabled("widget");

  const origin = publicOrigin();
  const project = `${context.workspace.slug}/${context.product.slug}`;
  // The loader is cached immutably, so the query marks the release that added
  // the nonce, live-region and degraded-state work; new installs fetch this
  // revision while an existing page keeps the bytes it already downloaded.
  const scriptUrl = `${origin}/widget/v1.js?v=6`;
  const embedPath = widgetEmbedPath(
    context.workspace.slug,
    context.product.slug,
  );
  const frameQuery = new URLSearchParams({
    host: settings.allowedOrigins[0] ?? origin,
    key: settings.publicKey,
  });
  const frameHref = `${embedPath}?${frameQuery.toString()}`;

  const accentColor = branding.primaryColor || "#1f6b45";
  const snippet = `<script
  async
  id="herald-widget"
  src="${scriptUrl}"
  data-project="${project}"
  data-key="${settings.publicKey}"
  data-position="${settings.position}"
  data-theme="${settings.theme}"
  data-sections="${settings.sections.join(",")}"
  data-accent="${accentColor}"
  data-accent-fg="${foregroundFor(accentColor)}"
></script>`;

  const logoUrl = branding.hasLogo
    ? `/api/public/workspaces/${encodeURIComponent(context.workspace.slug)}/logo?v=${
        branding.updatedAt ? new Date(branding.updatedAt).getTime() : 0
      }`
    : null;

  const previewEntries = (changelog?.entries ?? []).map((entry) => ({
    id: entry.id,
    title: entry.title,
    summary: entry.summary || "A new update is ready for your customers.",
    category: entry.category,
    publishedLabel: formatPreviewDate(entry.publishedAt),
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-col gap-4 border-b border-border/70 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-mono text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            <span>In-app distribution</span>
            <span aria-hidden="true" className="text-border">
              /
            </span>
            <span className="text-foreground/65">{context.product.name}</span>
          </p>
          <h1 className="mt-1.5 [font-family:var(--font-archivo)] text-[30px] font-semibold leading-[1.05] tracking-[-0.025em] text-foreground">
            In-app widget
          </h1>
          <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-muted-foreground">
            Configure and embed the in-app announcement bell, changelog and
            feedback inside your product.
          </p>
        </div>

        <div className="shrink-0 sm:pt-1">
          <span
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11.5px] font-medium",
              widgetEnabled
                ? "border-success/25 bg-success-muted/60 text-success"
                : "border-warning/30 bg-warning-muted text-warning",
            )}
          >
            <span
              className={cn(
                "size-2 rounded-full",
                widgetEnabled ? "bg-success" : "bg-warning",
              )}
              aria-hidden="true"
            />
            Widget state: {widgetEnabled ? "Preview mode" : "Disabled"}
          </span>
          <p className="mt-1.5 text-[10.5px] text-muted-foreground sm:text-right">
            Simulated preview · no live script ping
          </p>
        </div>
      </header>

      {!widgetEnabled ? (
        <div className="rounded-lg border border-warning/40 bg-warning-muted px-4 py-3 text-sm text-warning">
          The widget is disabled for this deployment. Set{" "}
          <code className="font-mono text-xs">FLAG_WIDGET=on</code> and restart
          before installing the snippet.
        </div>
      ) : null}

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-2 border-b border-border/70 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[8px] border border-border/80 bg-muted/60 text-muted-foreground">
              <Activity className="size-4" strokeWidth={1.8} aria-hidden="true" />
            </span>
            <div>
              <h2 className="[font-family:var(--font-archivo)] text-[15px] font-semibold tracking-[-0.01em] text-foreground">
                Widget health
              </h2>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                What the loader last reported. An install is counted once per
                widget boot; no page URL or visitor identity is stored.
              </p>
            </div>
          </div>
          <span className="w-fit rounded-full border border-border/80 bg-muted/40 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
            {health.lastInstallAt ? "Reporting" : "No install seen"}
          </span>
        </div>

        <dl className="grid gap-px bg-border/60 sm:grid-cols-2 lg:grid-cols-4">
          <div className="bg-card p-4">
            <dt className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              <Clock3 className="size-3" aria-hidden="true" />
              Last seen install
            </dt>
            <dd className="mt-1.5 text-[12.5px] font-medium text-foreground">
              {health.lastInstallAt
                ? new Intl.DateTimeFormat("en", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(health.lastInstallAt))
                : "None yet"}
            </dd>
            <p className="mt-1 text-[10.5px] text-muted-foreground">
              {health.installsLast7Days} install
              {health.installsLast7Days === 1 ? "" : "s"} in the last 7 days
            </p>
          </div>

          <div className="bg-card p-4">
            <dt className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              <Code2 className="size-3" aria-hidden="true" />
              Loader version
            </dt>
            <dd className="mt-1.5 font-mono text-[12.5px] font-medium text-foreground">
              {health.lastVersion ?? "\u2014"}
            </dd>
            <p className="mt-1 text-[10.5px] text-muted-foreground">
              Upgrade by replacing the snippet; see the versioning guide.
            </p>
          </div>

          <div className="bg-card p-4">
            <dt className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              <Globe2 className="size-3" aria-hidden="true" />
              Last origin
            </dt>
            <dd className="mt-1.5 truncate font-mono text-[11.5px] font-medium text-foreground">
              {health.lastOrigin ?? "\u2014"}
            </dd>
            <p className="mt-1 text-[10.5px] text-muted-foreground">
              {health.origins.length === 0
                ? "No origin reported yet"
                : `${health.origins.length} origin${health.origins.length === 1 ? "" : "s"} seen`}
            </p>
          </div>

          <div className="bg-card p-4">
            <dt className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              <Bell className="size-3" aria-hidden="true" />
              Unread state
            </dt>
            <dd className="mt-1.5 text-[12.5px] font-medium text-foreground">
              {health.unread} unread
            </dd>
            <p className="mt-1 text-[10.5px] text-muted-foreground">
              In-app notifications waiting across customers.
            </p>
          </div>
        </dl>
      </Card>

      <WidgetSettingsView
        workspaceSlug={workspaceSlug}
        productSlug={productSlug}
        settings={settings}
        identity={{ enabled: identity.enabled, hasSecret: identity.hasSecret }}
        canManage={canManage}
        snippet={snippet}
        frameHref={frameHref}
        preview={{
          brandName: branding.brandName || context.workspace.name,
          productName: context.product.name,
          workspaceSlug: context.workspace.slug,
          accentColor: branding.primaryColor || "#1f6b45",
          logoUrl,
          entries: previewEntries,
          showAttribution: !branding.hideAttribution,
          sections: settings.sections,
        }}
      />

      <Card id="developer-reference" className="scroll-mt-24 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border/70 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[8px] border border-border/80 bg-muted/60 text-muted-foreground">
              <Code2 className="size-4" strokeWidth={1.8} aria-hidden="true" />
            </span>
            <div>
              <h2 className="[font-family:var(--font-archivo)] text-[15px] font-semibold tracking-[-0.01em] text-foreground">
                Developer reference
              </h2>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                The loader is one async file. These are the optional attributes,
                inline embed, SDK calls and CSP directives.
              </p>
            </div>
          </div>
          <span className="w-fit rounded-full border border-border/80 bg-muted/40 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
            Loader v1
          </span>
        </div>

        <ReferenceSection
          title="Loader attributes"
          description="Everything the script tag can read without inline JavaScript."
        >
          <ul className="space-y-2">
            <li>
              <code className="rounded border bg-muted px-1 py-0.5 font-mono text-[10.5px] text-foreground">
                data-key
              </code>{" "}
              — the public installation key from the snippet above. Required once
              this workspace is configured.
            </li>
            <li>
              <code className="rounded border bg-muted px-1 py-0.5 font-mono text-[10.5px] text-foreground">
                data-position
              </code>{" "}
              — <code className="font-mono text-[10.5px]">bottom-right</code>{" "}
              (default), <code className="font-mono text-[10.5px]">bottom-left</code>,{" "}
              <code className="font-mono text-[10.5px]">top-right</code> or{" "}
              <code className="font-mono text-[10.5px]">top-left</code>.
            </li>
            <li>
              <code className="rounded border bg-muted px-1 py-0.5 font-mono text-[10.5px] text-foreground">
                data-theme
              </code>{" "}
              — <code className="font-mono text-[10.5px]">light</code>,{" "}
              <code className="font-mono text-[10.5px]">dark</code> or{" "}
              <code className="font-mono text-[10.5px]">auto</code>; omit to
              inherit public branding.
            </li>
            <li>
              <code className="rounded border bg-muted px-1 py-0.5 font-mono text-[10.5px] text-foreground">
                data-sections
              </code>{" "}
              — comma-separated extra panels:{" "}
              <code className="font-mono text-[10.5px]">feedback</code>,{" "}
              <code className="font-mono text-[10.5px]">roadmap</code>,{" "}
              <code className="font-mono text-[10.5px]">messages</code>. Omit for
              every available panel; an empty value hides them all.
            </li>
            <li>
              <code className="rounded border bg-muted px-1 py-0.5 font-mono text-[10.5px] text-foreground">
                data-locale
              </code>{" "}
              — <code className="font-mono text-[10.5px]">en</code> or{" "}
              <code className="font-mono text-[10.5px]">es</code>; omit to
              inherit the visitor&apos;s public locale.
            </li>
            <li>
              <code className="rounded border bg-muted px-1 py-0.5 font-mono text-[10.5px] text-foreground">
                data-panel
              </code>{" "}
              — initial panel such as{" "}
              <code className="font-mono text-[10.5px]">updates</code>.
            </li>
            <li>
              <code className="rounded border bg-muted px-1 py-0.5 font-mono text-[10.5px] text-foreground">
                data-trigger
              </code>{" "}
              — a CSS selector for your own launcher; the built-in button is not
              rendered.
            </li>
            <li>
              <code className="rounded border bg-muted px-1 py-0.5 font-mono text-[10.5px] text-foreground">
                data-label
              </code>{" "}
              — accessible label when you do not use the localized default.
            </li>
            <li>
              <code className="rounded border bg-muted px-1 py-0.5 font-mono text-[10.5px] text-foreground">
                data-nonce
              </code>{" "}
              — a per-response CSP nonce, copied to the shadow-root stylesheet.
              Nothing is rendered inline.
            </li>
          </ul>
        </ReferenceSection>

        <ReferenceSection
          title="Inline embed"
          description="Put the full experience inside your own page instead of a floating launcher."
        >
          <p>
            Give the container a height; without one the embed uses a 560px
            minimum. <code className="font-mono text-[10.5px]">navigate()</code>{" "}
            updates the frame and the host URL, and{" "}
            <code className="font-mono text-[10.5px]">destroy()</code> removes the
            embed.
          </p>
          <CodeBlock>{`<div id="herald-feedback"></div>
<script>
  document
    .getElementById("herald-widget")
    .addEventListener("load", () => {
      HeraldWidget.embed("#herald-feedback", {
        panel: "feedback",
        syncUrl: true,
      });
    });
</script>`}</CodeBlock>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            <li>
              <code className="font-mono text-[10.5px]">target</code> — selector
              or element (required).
            </li>
            <li>
              <code className="font-mono text-[10.5px]">panel</code> — initial
              panel, e.g.{" "}
              <code className="font-mono text-[10.5px]">feedback</code> or{" "}
              <code className="font-mono text-[10.5px]">roadmap</code>.
            </li>
            <li>
              <code className="font-mono text-[10.5px]">syncUrl</code> — default{" "}
              <code className="font-mono text-[10.5px]">true</code>; writes the
              current panel to{" "}
              <code className="font-mono text-[10.5px]">?herald=</code> with{" "}
              <code className="font-mono text-[10.5px]">replaceState</code>.
            </li>
            <li>
              <code className="font-mono text-[10.5px]">urlParam</code> — defaults
              to <code className="font-mono text-[10.5px]">herald</code>.
            </li>
            <li>
              <code className="font-mono text-[10.5px]">theme</code> /{" "}
              <code className="font-mono text-[10.5px]">locale</code> — override
              the public branding for this embed.
            </li>
          </ul>
        </ReferenceSection>

        <ReferenceSection
          title="Host JavaScript"
          description="Control the launcher and react to widget state from your own app."
        >
          <CodeBlock>{`HeraldWidget.open("updates");
HeraldWidget.navigate("feedback");
HeraldWidget.identify(signedToken);
HeraldWidget.on("identify", ({ identified }) => {});
HeraldWidget.on("statechange", (state) => {});
HeraldWidget.logout();`}</CodeBlock>
          <p>
            Calls made before the launcher mounts are queued. Identity is
            token-only: invalid or expired tokens fail closed, and{" "}
            <code className="font-mono text-[10.5px]">logout()</code> clears the
            shared customer session.
          </p>
        </ReferenceSection>

        <ReferenceSection
          title="Custom launcher"
          description="Keep your own button and let the loader update its unread state."
        >
          <p>
            Add <code className="font-mono text-[10.5px]">data-trigger</code>. The
            loader sets{" "}
            <code className="font-mono text-[10.5px]">data-herald-unread</code>{" "}
            and{" "}
            <code className="font-mono text-[10.5px]">data-herald-online</code> on
            it, and the same values are available from events.
          </p>
          <CodeBlock>{`<button id="feedback-launcher" type="button">
  Feedback <span id="feedback-unread" hidden></span>
</button>
<script async id="herald-widget"
        src="${scriptUrl}"
        data-project="${project}"
        data-key="${settings.publicKey}"
        data-position="${settings.position}"
        data-theme="${settings.theme}"
        data-sections="${settings.sections.join(",")}"
        data-trigger="#feedback-launcher"></script>`}</CodeBlock>
          <CodeBlock>{`HeraldWidget.on("unread", (count) => {
  const badge = document.getElementById("feedback-unread");
  badge.hidden = count === 0;
  badge.textContent = String(count);
});`}</CodeBlock>
        </ReferenceSection>

        <ReferenceSection
          title="React and Next.js"
          description="Every framework ends up rendering the same async tag; nothing is added inline."
        >
          <p>
            In a single-page app that mounts from JavaScript, create the tag once.
            In a Next.js App Router layout, render it directly — React 19 hoists
            and de-duplicates async scripts.
          </p>
          <div className="grid gap-3 lg:grid-cols-2">
            <div>
              <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                React
              </p>
              <CodeBlock>{`useEffect(() => {
  if (document.getElementById("herald-widget")) return;
  const script = document.createElement("script");
  script.id = "herald-widget";
  script.async = true;
  script.src = "${scriptUrl}";
  script.dataset.project = "${project}";
  script.dataset.key = "${settings.publicKey}";
  script.dataset.position = "${settings.position}";
  script.dataset.theme = "${settings.theme}";
  script.dataset.sections = "${settings.sections.join(",")}";
  document.body.appendChild(script);
}, []);`}</CodeBlock>
            </div>
            <div>
              <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                Next.js App Router
              </p>
              <CodeBlock>{`// app/layout.tsx
<script
  async
  id="herald-widget"
  src="${scriptUrl}"
  data-project="${project}"
  data-key="${settings.publicKey}"
  data-position="${settings.position}"
  data-theme="${settings.theme}"
  data-sections="${settings.sections.join(",")}"
/>`}</CodeBlock>
            </div>
          </div>
          <p>
            Identity is the same call in both:{" "}
            <code className="font-mono text-[10.5px]">
              HeraldWidget.identify(signedToken)
            </code>{" "}
            once your own session is ready. Invalid or expired tokens fail closed.
          </p>
        </ReferenceSection>

        <ReferenceSection
          title="Content-Security-Policy"
          description="The loader needs script, style and frame permission for this origin."
        >
          <p>
            There is no inline script or inline style to allow. Panels include
            home, feedback and compose, roadmap, changelog, messages and
            notifications.
          </p>
          <CodeBlock>{`script-src ${origin};
style-src ${origin};
frame-src ${origin};
connect-src ${origin};`}</CodeBlock>
          <p>
            If your policy uses nonces instead, add{" "}
            <code className="font-mono text-[10.5px]">data-nonce</code> to the
            script tag and give the tag your own nonce too; the loader forwards
            it to the stylesheet. Launcher position and theme can be overridden
            per allowed origin on this page. A host whose browser blocks the
            iframe&apos;s cookies sees an explanation with Try again and Open in
            a new tab instead of an empty panel.
          </p>
        </ReferenceSection>
      </Card>
    </div>
  );
}
