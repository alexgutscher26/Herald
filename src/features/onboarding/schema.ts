import { z } from "zod";

/**
 * Onboarding input validation.
 *
 * Slug *format* is checked here with `validateSlug` in the server action so
 * that the exact same rules run in the browser and on the server; this schema
 * only guarantees presence and length.
 */
export const onboardingSchema = z.object({
  workspaceName: z
    .string()
    .min(1, "Workspace name is required.")
    .max(60, "Workspace name must be 60 characters or fewer."),
  workspaceSlug: z.string().min(1, "Workspace URL is required."),
  productName: z
    .string()
    .min(1, "Product name is required.")
    .max(60, "Product name must be 60 characters or fewer."),
  productSlug: z.string().min(1, "Product URL is required."),
  /** Set by the pricing page's lifetime CTA to land on Billing after setup. */
  offerLifetime: z.boolean().optional(),
});

export type OnboardingValues = z.infer<typeof onboardingSchema>;

export type OnboardingResult = {
  ok: boolean;
  redirectTo?: string;
  formError?: string;
  fieldErrors?: Record<string, string>;
};

/** Flatten a Zod v4 issue map into `field -> message`. */
export function flattenIssues(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!result[key]) result[key] = issue.message;
  }
  return result;
}