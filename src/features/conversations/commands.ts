/**
 * Slash commands in the conversation composer.
 *
 * A command is recognized only when it is the first token of the message, so
 * a customer quoting "/resolve" inside a sentence is unaffected. The parser is
 * pure and returns a value the service applies before saving the remaining
 * text, which keeps command handling out of the UI and testable without a
 * database.
 *
 * Supported:
 *   /resolve            close the thread
 *   /reopen             put it back in Open
 *   /spam               move it to Spam
 *   /archive            archive it
 *   /snooze <duration>  snooze for 30m, 2h or 3d (5 minutes to 30 days)
 *   /note <text>        save an internal note instead of a customer reply
 */

export const MAX_COMMAND_LENGTH = 60;
const MAX_SNOOZE_MINUTES = 30 * 24 * 60;
const MIN_SNOOZE_MINUTES = 5;

export type ParsedComposerInput =
  | { kind: "message"; body: string }
  | { kind: "note"; body: string }
  | { kind: "status"; status: "resolved" | "open" | "spam" | "archived"; body: string }
  | { kind: "snooze"; minutes: number; body: string }
  | { kind: "error"; error: string };

export function parseComposerInput(input: string): ParsedComposerInput {
  const text = input.trim();
  if (text === "") return { kind: "error", error: "Write a reply first." };
  if (!text.startsWith("/")) return { kind: "message", body: text };

  const match = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i.exec(text);
  if (!match) {
    return {
      kind: "error",
      error: `A command looks like /resolve or /note <text>.`,
    };
  }

  const command = (match[1] ?? "").toLowerCase();
  const rest = (match[2] ?? "").trim();

  switch (command) {
    case "resolve":
      return { kind: "status", status: "resolved", body: rest };
    case "reopen":
      return { kind: "status", status: "open", body: rest };
    case "spam":
      return { kind: "status", status: "spam", body: rest };
    case "archive":
      return { kind: "status", status: "archived", body: rest };
    case "note":
      if (rest === "") {
        return { kind: "error", error: "Write something after /note." };
      }
      return { kind: "note", body: rest };
    case "snooze": {
      const minutes = parseSnoozeMinutes(rest.split(/\s+/)[0] ?? "");
      if (minutes === null) {
        return {
          kind: "error",
          error: "Use /snooze 30m, /snooze 2h or /snooze 3d.",
        };
      }
      return {
        kind: "snooze",
        minutes,
        body: rest.split(/\s+/).slice(1).join(" ").trim(),
      };
    }
    default:
      return {
        kind: "error",
        error: `Unknown command /${command}. Try /resolve, /reopen, /snooze 2h or /note.`,
      };
  }
}

/** Parse `30m`, `2h`, `3d` or a plain minute count. */
export function parseSnoozeMinutes(value: string): number | null {
  const match = /^(\d{1,5})(m|h|d)?$/i.exec(value.trim());
  if (!match?.[1]) return null;
  const amount = Number.parseInt(match[1], 10);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = (match[2] ?? "m").toLowerCase();
  const minutes = unit === "d" ? amount * 24 * 60 : unit === "h" ? amount * 60 : amount;
  if (minutes < MIN_SNOOZE_MINUTES || minutes > MAX_SNOOZE_MINUTES) return null;
  return minutes;
}

/** Human label for a status, shared by the inbox and the thread header. */
export function conversationStatusLabel(status: string): string {
  switch (status) {
    case "queue":
      return "Queue";
    case "open":
      return "Open";
    case "snoozed":
      return "Snoozed";
    case "resolved":
      return "Resolved";
    case "spam":
      return "Spam";
    case "archived":
      return "Archived";
    default:
      return "Unknown";
  }
}
