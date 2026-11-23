import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { en } from "@/features/public/i18n/messages/en";
import { es } from "@/features/public/i18n/messages/es";

/**
 * Public accessibility contract.
 *
 * These are the structural checks that are cheap to keep: every public page has
 * one focusable main landmark, the shell exposes a skip link, and every public
 * form control has a programmatic label. Behavioural checks (focus order,
 * keyboard flow, 360 px layout) are exercised in the browser and recorded in
 * docs/accessibility-checklist.md.
 */

const ROOTS = ["src/app/p", "src/features/public"];

/** Page shells that render the content of a public route. */
const PAGE_SHELLS = [
  "src/app/p/[workspaceSlug]/not-found.tsx",
  "src/app/p/[workspaceSlug]/[productSlug]/login/page.tsx",
  "src/app/p/[workspaceSlug]/[productSlug]/preferences/page.tsx",
  "src/app/p/[workspaceSlug]/[productSlug]/[boardSlug]/submit/page.tsx",
  "src/app/p/[workspaceSlug]/[productSlug]/search/page.tsx",
  "src/features/public/board-view.tsx",
  "src/features/public/request-view.tsx",
];

async function tsxFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) return tsxFiles(full);
      return entry.isFile() && entry.name.endsWith(".tsx") ? [full] : [];
    }),
  );
  return files.flat();
}

function openingTags(source: string, tag: string): string[] {
  return [...source.matchAll(new RegExp(`<${tag}\\b[\\s\\S]{0,500}?>`, "g"))].map(
    (match) => match[0],
  );
}

describe("public accessibility structure", () => {
  test("every public page has one focusable main landmark", async () => {
    for (const file of PAGE_SHELLS) {
      const source = await readFile(file, "utf8");
      const mains = openingTags(source, "main");
      expect(mains.length, `${file} renders no main landmark`).toBeGreaterThan(0);
      for (const tag of mains) {
        expect(`${file}: ${tag}`).toContain('id="public-main"');
        expect(`${file}: ${tag}`).toContain("tabIndex={-1}");
      }
    }

    // A stray second main in any other public component would still be caught.
    const files = (await Promise.all(ROOTS.map(tsxFiles))).flat();
    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const tag of openingTags(source, "main")) {
        expect(`${file}: ${tag}`).toContain('id="public-main"');
        expect(`${file}: ${tag}`).toContain("tabIndex={-1}");
      }
    }
  });

  test("the public shell offers a skip link and both locales define it", async () => {
    const layout = await readFile(
      path.join("src/app/p/[workspaceSlug]/layout.tsx"),
      "utf8",
    );

    expect(layout).toContain('href="#public-main"');
    expect(layout).toContain('site.t("common.skipToContent")');
    expect(layout).toContain('<RouteFocusManager mainId="public-main" />');
    expect(en["common.skipToContent"]).toBe("Skip to content");
    expect(es["common.skipToContent"]).toBe("Saltar al contenido");
  });

  test("public form controls have ids and matching labels", async () => {
    const files = [
      "src/features/public/submit-form.tsx",
      "src/features/public/comment-form.tsx",
      "src/features/public/identify-form.tsx",
      "src/features/public/board-view.tsx",
      "src/features/subscribers/preferences-form.tsx",
    ];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      const controls = [
        ...openingTags(source, "Input"),
        ...openingTags(source, "Textarea"),
        ...openingTags(source, "select"),
        ...openingTags(source, "Switch"),
      ];

      for (const control of controls) {
        const id = control.match(/id="([^"]+)"/)?.[1];
        // A control whose id is a per-question expression cannot be compared
        // literally here; require the expression form and a matching
        // expression label instead of letting an id-less control pass.
        const dynamicId = /id=\{/.test(control);
        expect(id ?? (dynamicId ? "dynamic" : undefined), `${file}: ${control.slice(0, 80)}`).toBeTruthy();
        if (id) {
          expect(source).toContain(`htmlFor="${id}"`);
        } else {
          expect(source).toContain("htmlFor={");
        }
      }
    }
  });

  test("the public language switch keeps a 24 px target", async () => {
    const header = await readFile("src/features/public/public-header.tsx", "utf8");
    expect(header).toContain("min-w-6");
    expect(header).toContain("justify-center");
  });

  test("the search page labels its input and does not steal focus", async () => {
    const source = await readFile(
      "src/app/p/[workspaceSlug]/[productSlug]/search/page.tsx",
      "utf8",
    );

    expect(source).toContain('htmlFor="portal-search-page"');
    expect(source).toContain('id="portal-search-page"');
    expect(source).not.toContain("autoFocus");
    expect(source).toContain("robots: { index: false, follow: true }");
  });

  test("marketing and trust shells provide a bypass link and a focusable main", async () => {
    const marketing = await readFile("src/features/marketing/marketing-chrome.tsx", "utf8");
    const landing = await readFile("src/features/marketing/landing-page.tsx", "utf8");
    const legal = await readFile("src/components/trust/legal-shell.tsx", "utf8");

    for (const source of [marketing, landing, legal]) {
      expect(source).toContain("Skip to content");
    }
    expect(marketing).toContain('href="#main"');
    expect(marketing).toContain('<main id="main" tabIndex={-1}>');
    expect(landing).toContain('<main id="main" tabIndex={-1}>');
    expect(legal).toContain('href="#legal-main"');
    expect(legal).toContain('<main id="legal-main" tabIndex={-1}');
  });
});
