/**
 * Compatibility re-export for the canonical action result.
 *
 * The shape lives in `@/lib/action-result` so client and server code share one
 * definition. Existing server actions import this path; new code should import
 * from `@/lib/action-result`.
 */

export {
  actionError,
  actionFailure,
  actionSuccess,
  type ActionFailure,
  type ActionResult,
} from "@/lib/action-result";
