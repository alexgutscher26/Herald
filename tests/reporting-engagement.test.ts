import { describe, expect, test } from "bun:test";

import {
  REPORT_DATASETS,
  findDataset,
  validateMetricSelection,
} from "@/features/reporting/catalogue";

/**
 * Engagement reports must be catalogue-backed like every other dataset: a
 * saved report can only name allowlisted metrics, and both recipient-counted
 * metrics are present.
 */

describe("engagement report catalogue", () => {
  test("exposes survey responses and tour completions", () => {
    const dataset = findDataset("engagement");
    expect(dataset).not.toBeNull();
    expect(dataset?.metrics.map((metric) => metric.key)).toEqual([
      "survey_responses",
      "tour_completions",
    ]);

    const selection = validateMetricSelection("engagement", [
      "survey_responses",
      "tour_completions",
    ]);
    expect(selection.dataset.key).toBe("engagement");
    expect(selection.metrics).toHaveLength(2);
  });

  test("rejects metrics from another dataset", () => {
    expect(() =>
      validateMetricSelection("engagement", ["requests_created"]),
    ).toThrow(/not a metric/);
    expect(() => validateMetricSelection("unknown", ["survey_responses"])).toThrow(
      /known dataset/,
    );
  });

  test("every dataset still has a label, description and metrics", () => {
    for (const dataset of REPORT_DATASETS) {
      expect(dataset.label.length).toBeGreaterThan(0);
      expect(dataset.description.length).toBeGreaterThan(0);
      expect(dataset.metrics.length).toBeGreaterThan(0);
    }
  });
});
