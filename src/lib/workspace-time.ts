/**
 * The workspace's IANA display zone.
 *
 * The dashboard snapshot exposes `Workspace.timezone`; it currently resolves to
 * UTC for every workspace because the tenant table stores instants, not a
 * configurable wall-clock zone. Server pages that do not load the snapshot use
 * this same value so both sides label the same zone.
 */
export const DEFAULT_WORKSPACE_TIMEZONE = "UTC";
