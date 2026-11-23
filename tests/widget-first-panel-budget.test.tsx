import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { renderToStaticMarkup } from "react-dom/server";

import { createTranslator } from "@/features/public/i18n";
import { WidgetChrome } from "@/features/widget/shell";
import type { WidgetShell } from "@/features/widget/service";
import { WidgetWhatsNewView } from "@/features/widget/whats-new-view";

import { WIDGET_FIRST_PANEL_BUDGET } from "../scripts/bundle-budgets";

/**
 * First-open budget.
 *
 * The old budget stopped at the loader and its stylesheet. The customer waits
 * for one more thing: the first panel's server-rendered markup. This renders
 * the real home-panel chrome with a representative shell and measures all
 * three pieces together. Next.js client chunks are outside this check; the
 * browser contract (no loader request of its own, frame preloaded) remains in
 * tests/widget-budget.test.ts.
 */

const shell: WidgetShell = {
  workspace: { id: "workspace", name: "Acme", slug: "acme" },
  product: {
    id: "product",
    name: "Acme App",
    slug: "app",
    description: "Ship customer feedback faster.",
    publicFeedbackEnabled: true,
    publicRoadmapEnabled: true,
    publicChangelogEnabled: true,
  },
  boardSlug: "requests",
  viewer: null,
  unread: 3,
  presence: { online: true },
  panels: {
    help: true,
    feedback: true,
    roadmap: true,
    updates: true,
    messages: true,
    notifications: true,
  },
};

const items = Array.from({ length: 3 }, (_, index) => ({
  id: `entry-${index}`,
  title: `A representative changelog entry ${index + 1}`,
  summary:
    "A short summary of what changed, with enough copy to look like the real panel.",
  categoryLabel: "Feature",
  category: "feature" as const,
  dateLabel: "Nov 21",
  href: `/p/acme/app/updates/entry-${index}`,
}));

describe("widget first-panel budget", () => {
  test("loader + stylesheet + first panel markup stay inside the budget", async () => {
    const [loader, css] = await Promise.all([
      readFile(path.join(process.cwd(), "public/widget/v1.js")),
      readFile(path.join(process.cwd(), "public/widget/v1.css")),
    ]);

    const { t } = createTranslator("en");
    const panel = Buffer.from(
      renderToStaticMarkup(
        <WidgetChrome
          shell={shell}
          accentColor="#1f6b45"
          locale="en"
          t={t}
          active="home"
          query={{}}
          hostOrigin="https://app.example.test"
          sections={["feedback", "roadmap"]}
        >
          <WidgetWhatsNewView
            items={items}
            labels={{
              search: "Search updates",
              noResults: "No updates match",
              emptyTitle: "No published updates",
              emptyBody: "Publish a changelog entry to see it here.",
            }}
          />
        </WidgetChrome>,
      ),
    );

    const raw = loader.byteLength + css.byteLength + panel.byteLength;
    const gzip =
      gzipSync(loader).byteLength +
      gzipSync(css).byteLength +
      gzipSync(panel).byteLength;

    expect(panel.byteLength).toBeGreaterThan(1024);
    expect(raw).toBeLessThanOrEqual(WIDGET_FIRST_PANEL_BUDGET.rawBytes);
    expect(gzip).toBeLessThanOrEqual(WIDGET_FIRST_PANEL_BUDGET.gzipBytes);
  });
});
