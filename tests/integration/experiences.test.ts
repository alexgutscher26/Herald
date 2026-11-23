import { afterAll, beforeAll, describe, expect } from "bun:test";

import { db } from "@/db";
import {
  widgetExperienceCompletions,
  widgetExperienceDismissals,
  widgetExperiences,
} from "@/db/schema";
import { listExperiences } from "@/features/engagement/service";

import { createProduct, createWorkspace } from "./factories";
import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";

/**
 * The admin experiences list joins two separately aggregated count subqueries.
 * Both expose a `total` column, so the outer query must qualify them; this
 * catches the ambiguous-column regression that a page render would otherwise
 * surface only against a real database.
 */

beforeAll(async () => {
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

describe("experience administration", () => {
  isolatedTest("lists dismissal and completion totals", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);

    const [experience] = await db
      .insert(widgetExperiences)
      .values({
        workspaceId: workspace.id,
        productId: product.id,
        kind: "tour",
        name: "Welcome tour",
        status: "active",
        content: {
          en: {
            title: "Welcome",
            body: "A quick tour.",
            steps: [{ selector: "#start", title: "Start", body: "First step." }],
          },
        },
      })
      .returning();
    if (!experience) throw new Error("Experience insert returned no row.");

    await db.insert(widgetExperienceDismissals).values({
      experienceId: experience.id,
      workspaceId: workspace.id,
      visitorKey: "visitor-one",
    });
    await db.insert(widgetExperienceCompletions).values({
      experienceId: experience.id,
      workspaceId: workspace.id,
      productId: product.id,
      visitorKey: "visitor-one",
    });

    const rows = await listExperiences(product.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: experience.id,
      dismissals: 1,
      completions: 1,
    });
  });
});
