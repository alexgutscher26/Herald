/**
 * Trial length policy for paid plans.
 *
 * The base trial is 14 days. A workspace that has completed the product setup
 * checklist starts with 30 days instead. Checkout resolves this on the server;
 * a browser cannot send a trial length.
 */

export const DEFAULT_TRIAL_DAYS = 14;
export const SETUP_COMPLETE_TRIAL_DAYS = 30;

export function trialDaysForSetup(setupComplete: boolean): number {
  return setupComplete ? SETUP_COMPLETE_TRIAL_DAYS : DEFAULT_TRIAL_DAYS;
}
