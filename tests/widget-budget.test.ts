import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { WIDGET_BUDGETS } from "../scripts/bundle-budgets";

/**
 * Widget bundle budget.
 *
 * The loader is shipped to every visitor of every embedding site, so growth is
 * a product decision rather than an incidental side effect of a feature. These
 * ceilings leave a little room for fixes but fail before the one-tag install
 * becomes a material cost. Update the budget deliberately, not to make a red
 * test green.
 */

describe("widget bundle budget", () => {
  for (const budget of WIDGET_BUDGETS) {
    test(`${budget.file} stays inside its shipped budget`, async () => {
      const contents = await readFile(path.join(process.cwd(), budget.file));
      const gzipped = gzipSync(contents);

      expect(contents.byteLength).toBeLessThanOrEqual(budget.rawBytes);
      expect(gzipped.byteLength).toBeLessThanOrEqual(budget.gzipBytes);
    });
  }
});

/**
 * First-open budget.
 *
 * Size alone does not describe the cost the loader adds to a host page. These
 * checks keep the two properties the measured budget depends on: the loader
 * itself makes no network request, and the embed frame is already loading when
 * the panel is opened, so opening only toggles visibility instead of starting a
 * navigation. Measure the latency with docs/widget-browser-smoke.md.
 */
describe("widget first-open budget", () => {
  const loader = () =>
    readFile(path.join(process.cwd(), "public/widget/v1.js"), "utf8");

  test("the loader adds no network request of its own to the host page", async () => {
    const source = await loader();

    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toContain("XMLHttpRequest");
    expect(source).not.toMatch(/\bimport\s*\(/);
  });

  test("the embed frame is preloaded so first open is a visibility toggle", async () => {
    const source = await loader();

    expect(source).toContain('frame.setAttribute("loading", "eager")');
    expect(source).toContain("panel.hidden = false");

    const preloads =
      source.match(/frame\.src = buildFrameUrl\(state\.panel\)/g) ?? [];
    expect(preloads.length).toBeGreaterThanOrEqual(2);
  });
});
