import {
  SIGNUP_FUNNEL_STAGES,
  type SignupFunnelStage,
} from "@/db/schema/signup-funnel";

export const SIGNUP_FUNNEL_LABELS: Record<SignupFunnelStage, string> = {
  sign_up_view: "Sign-up page views",
  account_created: "Accounts created",
  workspace_created: "Workspaces created",
  first_release: "First releases published",
  widget_installed: "Widget installs recorded",
};

export type SignupFunnelStep = {
  stage: SignupFunnelStage;
  label: string;
  count: number;
  /** Share of the previous step; null for the first step or a zero baseline. */
  rate: number | null;
};

export type SignupFunnelReport = {
  days: number;
  from: string;
  to: string;
  steps: SignupFunnelStep[];
};

/** Pure arithmetic, exported so the report shape is testable without Postgres. */
export function buildSignupFunnel(
  counts: Record<SignupFunnelStage, number>,
): SignupFunnelStep[] {
  return SIGNUP_FUNNEL_STAGES.map((stage, index) => {
    const count = Math.max(0, Math.trunc(counts[stage] ?? 0));
    const previousStage = index === 0 ? null : SIGNUP_FUNNEL_STAGES[index - 1]!;
    const previous =
      previousStage === null
        ? null
        : Math.max(0, Math.trunc(counts[previousStage] ?? 0));
    return {
      stage,
      label: SIGNUP_FUNNEL_LABELS[stage],
      count,
      rate: previous === null || previous === 0 ? null : count / previous,
    };
  });
}
