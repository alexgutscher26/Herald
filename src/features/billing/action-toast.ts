"use client";

/**
 * Compatibility path for the shared action toast helper.
 *
 * The implementation lives in `@/components/shared/action-toast` so billing and
 * non-billing actions use the same failure and plan-limit behaviour.
 */

export { toastActionFailure } from "@/components/shared/action-toast";
