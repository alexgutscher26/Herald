import type { Metadata } from "next";
import { notFound } from "next/navigation";

import type { ExperienceCopy } from "@/db/schema/engagement";
import { resolveExperiencePreview } from "@/features/engagement/preview";
import { WIDGET_ASSET_REVISION } from "@/features/widget/paths";
import { readWidgetAccessSettings } from "@/features/widget/settings";

/**
 * A host-page harness for one saved tour or banner.
 *
 * The real loader runs here with a short-lived preview token, so the operator
 * sees the same banner/tour, launcher and locale switch a customer would. The
 * token bypasses status, schedule, audience, dismissals and frequency without
 * writing any analytics. Simple id/class step selectors get a visible stand-in
 * on the page; a selector that matches nothing cannot be previewed this way.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Experience preview",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type TargetProps = { id?: string; className?: string };

function targetProps(selector: string): TargetProps | null {
  if (/^#[A-Za-z][\w-]*$/.test(selector)) return { id: selector.slice(1) };
  if (/^\.[A-Za-z][\w-]*$/.test(selector)) return { className: selector.slice(1) };
  return null;
}

export default async function ExperiencePreviewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const preview = await resolveExperiencePreview(token);
  if (!preview) notFound();

  const settings = await readWidgetAccessSettings(preview.workspaceId);
  const copy = preview.content[preview.defaultLocale] as ExperienceCopy | undefined;
  const selectors = Array.from(
    new Set((copy?.steps ?? []).map((step) => step.selector).filter(Boolean)),
  );
  const targets = selectors
    .map((selector) => ({ selector, props: targetProps(selector) }))
    .filter((entry): entry is { selector: string; props: TargetProps } =>
      Boolean(entry.props),
    );

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Preview · not visible to customers
      </p>
      <h1 className="mt-2 text-2xl font-semibold">{preview.name}</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        The live widget is running on this page. This link ignores the
        experience&apos;s status, schedule, audience, dismissal memory and
        frequency cap, and records nothing. It expires one hour after it was
        generated.
      </p>

      <div className="mt-8 rounded-xl border bg-card p-6">
        <div className="flex items-center justify-between border-b pb-4">
          <span className="font-semibold">Example product</span>
          <span className="rounded-md border px-2 py-1 text-xs text-muted-foreground">
            Sample host page
          </span>
        </div>
        <div className="mt-6 space-y-4">
          <div className="h-3 w-2/3 rounded bg-muted" />
          <div className="h-3 w-1/2 rounded bg-muted" />
          <div className="h-24 rounded-lg bg-muted" />
        </div>

        {targets.length > 0 ? (
          <div className="mt-6 space-y-3 border-t pt-6">
            <p className="text-sm font-medium">Tour targets on this page</p>
            {targets.map(({ selector, props }) => (
              <div
                key={selector}
                {...props}
                className={`${props.className ?? ""} rounded-lg border border-dashed border-primary/40 bg-primary/5 p-4`}
              >
                <p className="text-sm font-medium">
                  <code>{selector}</code>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Stand-in for the element this step points at.
                </p>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {selectors.length > targets.length ? (
        <p className="mt-4 text-xs text-muted-foreground">
          {selectors.length - targets.length} selector
          {selectors.length - targets.length === 1 ? " has" : "s have"} no
          stand-in on this page. A step whose selector is missing everywhere is
          skipped by the loader, so open the preview on the real page to check
          it.
        </p>
      ) : null}

      <script
        async
        src={`/widget/v1.js?v=${WIDGET_ASSET_REVISION}`}
        data-project={`${preview.workspaceSlug}/${preview.productSlug}`}
        data-key={settings?.publicKey}
        data-preview={token}
        data-locale={preview.defaultLocale}
      />
    </main>
  );
}
