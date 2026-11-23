/**
 * Dashboard re-export of the shared audience rules.
 *
 * The implementation lives in `@/lib/feedback-privacy` so the public surface
 * can use the same vocabulary without importing dashboard code.
 */
export {
  canPublishWithPrivacy,
  canViewPrivateContent,
  FEEDBACK_PRIVACY_LABELS,
  FEEDBACK_PRIVACY_VALUES,
  isFeedbackPrivacy,
  privacyRequiresCompany,
} from "@/lib/feedback-privacy";
export type { FeedbackPrivacy } from "@/lib/feedback-privacy";
