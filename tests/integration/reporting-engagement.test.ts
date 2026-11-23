import { afterAll, beforeAll, describe, expect } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import {
  surveyResponses,
  surveys,
  widgetExperienceCompletions,
  widgetExperiences,
} from "@/db/schema";
import { completeExperience } from "@/features/engagement/service";
import { runReportQuery } from "@/features/reporting/query";

import {
  createCustomer,
  createProduct,
  createWorkspace,
  uniqueLabel,
} from "./factories";
import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";

/**
 * Engagement reports count recipients, not rows or button presses. The survey
 * path can legitimately contain several rows for one person, and the tour
 * completion path is idempotent. Both must still produce one report value per
 * recipient in the period, and neither may leak another product's rows.
 */

beforeAll(async () => {
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

describe("engagement report totals", () => {
  isolatedTest("counts each survey and tour recipient once", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const otherProduct = await createProduct(workspace.id);
    const ada = await createCustomer(workspace.id);
    const grace = await createCustomer(workspace.id);

    const [survey] = await db
      .insert(surveys)
      .values({
        workspaceId: workspace.id,
        productId: product.id,
        name: "How are we doing?",
        slug: uniqueLabel("survey"),
        kind: "nps",
        status: "active",
        questions: [{ id: "score", type: "rating", prompt: "Rate us", required: true }],
      })
      .returning();
    if (!survey) throw new Error("Survey insert returned no row.");

    // Two rows for Ada in the same survey must be one recipient; Grace is a
    // second recipient. The foreign product's response must never be counted.
    await db.insert(surveyResponses).values([
      {
        surveyId: survey.id,
        workspaceId: workspace.id,
        productId: product.id,
        customerId: ada.id,
        visitorKey: "ada-visitor",
        score: 9,
        createdAt: new Date(Date.now() - 60_000),
      },
      {
        surveyId: survey.id,
        workspaceId: workspace.id,
        productId: product.id,
        customerId: ada.id,
        visitorKey: "ada-visitor",
        score: 10,
      },
      {
        surveyId: survey.id,
        workspaceId: workspace.id,
        productId: product.id,
        customerId: grace.id,
        visitorKey: "grace-visitor",
        score: 8,
      },
    ]);

    const [foreignSurvey] = await db
      .insert(surveys)
      .values({
        workspaceId: workspace.id,
        productId: otherProduct.id,
        name: "Foreign survey",
        slug: uniqueLabel("foreign-survey"),
        kind: "custom",
        status: "active",
        questions: [],
      })
      .returning();
    if (!foreignSurvey) throw new Error("Foreign survey insert returned no row.");

    await db.insert(surveyResponses).values({
      surveyId: foreignSurvey.id,
      workspaceId: workspace.id,
      productId: otherProduct.id,
      customerId: ada.id,
      visitorKey: "ada-visitor",
      score: 9,
    });

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

    const complete = (visitorKey: string, customerId: string) =>
      completeExperience({
        workspaceSlug: workspace.slug,
        productSlug: product.slug,
        experienceId: experience.id,
        visitorKey,
        customerId,
      });

    expect(await complete("ada-tour", ada.id)).toBe(true);
    expect(await complete("ada-tour", ada.id)).toBe(true);
    expect(await complete("grace-tour", grace.id)).toBe(true);

    const completions = await db
      .select({ id: widgetExperienceCompletions.id })
      .from(widgetExperienceCompletions)
      .where(eq(widgetExperienceCompletions.experienceId, experience.id));
    expect(completions).toHaveLength(2);

    const report = await runReportQuery({
      workspaceId: workspace.id,
      productId: product.id,
      dataset: "engagement",
      metrics: ["survey_responses", "tour_completions"],
      days: 30,
      compare: false,
    });

    expect(report.totals).toEqual({
      survey_responses: 2,
      tour_completions: 2,
    });
  });
});
