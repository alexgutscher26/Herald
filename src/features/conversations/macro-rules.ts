import type { ConversationStatus } from "@/db/schema/conversations";

export type MacroStatus = "open" | "resolved" | "spam" | "archived";

export type ConversationMacroRow = {
  id: string;
  name: string;
  replyBody: string;
  tagName: string | null;
  status: ConversationStatus | null;
  assigneeId: string | null;
  assigneeName: string | null;
};

export const MACRO_STATUSES: MacroStatus[] = ["open", "resolved", "spam", "archived"];

export function normalizeTagName(value: string): string | null {
  const name = value.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 32);
  if (name === "") return null;
  return /^[a-z0-9][a-z0-9 _-]*$/.test(name) ? name : null;
}

/** Guard used by tests and by callers that want to render a status safely. */
export function isMacroStatus(value: string): value is MacroStatus {
  return (MACRO_STATUSES as string[]).includes(value);
}
