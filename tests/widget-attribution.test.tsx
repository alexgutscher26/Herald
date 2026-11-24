import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { createTranslator } from "@/features/public/i18n";
import { WidgetChrome } from "@/features/widget/shell";
import type { WidgetShell } from "@/features/widget/service";

/**
 * The embed obeys the same plan-gated branding flag as the hosted pages.
 * `getPublicSite` resolves that flag; these renders pin the chrome contract
 * without requiring a database or a live plan.
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
  unread: 0,
  presence: { online: true },
  panels: {
    help: false,
    feedback: false,
    roadmap: false,
    updates: false,
    messages: false,
    notifications: false,
  },
};

function renderChrome(hideAttribution: boolean): string {
  const { t } = createTranslator("en");
  return renderToStaticMarkup(
    <WidgetChrome
      shell={shell}
      accentColor="#1f6b45"
      locale="en"
      t={t}
      active="home"
      query={{}}
      hostOrigin="https://app.example.test"
      sections={[]}
      hideAttribution={hideAttribution}
    >
      <p>Panel content</p>
    </WidgetChrome>,
  );
}

describe("widget attribution", () => {
  test("shows the footer by default", () => {
    expect(renderChrome(false)).toContain("Powered by Herald");
  });

  test("removes the footer when the effective plan setting allows it", () => {
    expect(renderChrome(true)).not.toContain("Powered by Herald");
  });
});
