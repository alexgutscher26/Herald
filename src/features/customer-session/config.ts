/**
 * Customer session constants.
 *
 * The cookie is deliberately short-lived (24 hours) and workspace-agnostic:
 * the session row carries the workspace, so one visitor on a shared browser
 * has one active customer session at a time.
 */

export const CUSTOMER_SESSION_COOKIE = "herald_customer_session";

export const CUSTOMER_SESSION_TTL_SECONDS = 60 * 60 * 24;

export const CUSTOMER_SESSION_TTL_MS = CUSTOMER_SESSION_TTL_SECONDS * 1000;
