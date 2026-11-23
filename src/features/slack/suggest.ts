import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { boards } from "@/db/schema/boards";
import { generateAiText } from "@/features/ai/provider";
import { getAiConfig } from "@/lib/env";
import { logEvent, serializeError } from "@/lib/logger";

/**
 * Board and title suggestion for one Slack message.
 *
 * The AI path only runs when a provider is configured. It receives the board
 * ids and is allowed to choose only one of them; an unknown id, invalid JSON or
 * provider failure falls through to a deterministic first-line title and the
 * first active board. A suggestion must never block a request from being filed.
 */

type BoardChoice = { id: string; name: string; description: string | null; position: number };

export type SlackSuggestion = {
  boardId: string;
  boardName: string;
  title: string;
  body: string;
  category: "feature_request" | "bug" | "improvement" | "question";
  usedAi: boolean;
};

function cleanTitle(text: string, authorName: string): string {
  const firstLine = text
    .replace(/<@[A-Z0-9]+>/gi, " ")
    .split(/\n/)[0]
    ?.replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  if (firstLine && firstLine.length >= 3) return firstLine;
  return `Feedback from ${authorName}`.slice(0, 200);
}

function categoryFor(text: string): SlackSuggestion["category"] {
  if (/\b(bug|broken|crash|error|fails?|regression)\b/i.test(text)) return "bug";
  if (/\b(improve|improvement|faster|slower|polish)\b/i.test(text)) return "improvement";
  if (/\b(question|how do i|help)\b/i.test(text)) return "question";
  return "feature_request";
}

function keywordBoard(text: string, choices: BoardChoice[]): BoardChoice {
  const words = text.toLowerCase();
  let best = choices[0]!;
  let bestScore = 0;
  for (const board of choices) {
    const terms = `${board.name} ${board.description ?? ""}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length >= 4);
    const score = terms.reduce((total, term) => total + (words.includes(term) ? 1 : 0), 0);
    if (score > bestScore) {
      best = board;
      bestScore = score;
    }
  }
  return best;
}

function parseAiChoice(
  raw: string,
  choices: BoardChoice[],
  authorName: string,
): { board: BoardChoice; title: string } | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const candidate = parsed as { board_id?: unknown; title?: unknown };
  const board =
    typeof candidate.board_id === "string"
      ? choices.find((choice) => choice.id === candidate.board_id)
      : undefined;
  if (!board) return null;

  const title =
    typeof candidate.title === "string" ? candidate.title.trim().slice(0, 200) : "";
  if (title.length < 3) return null;

  return { board, title: title || cleanTitle("", authorName) };
}

export async function suggestSlackRequest(input: {
  productId: string;
  text: string;
  authorName: string;
}): Promise<SlackSuggestion | null> {
  const choices = await db
    .select({
      id: boards.id,
      name: boards.name,
      description: boards.description,
      position: boards.position,
    })
    .from(boards)
    .where(and(eq(boards.productId, input.productId), isNull(boards.archivedAt)))
    .orderBy(asc(boards.position), asc(boards.createdAt));

  if (choices.length === 0) return null;

  const text = input.text.trim().slice(0, 20_000);
  const fallback = {
    board: keywordBoard(text, choices),
    title: cleanTitle(text, input.authorName),
  };

  let aiConfigured = false;
  try {
    aiConfigured = getAiConfig() !== null;
  } catch {
    // A partial AI configuration must not block filing; use the fallback.
  }

  if (aiConfigured) try {
    const raw = await generateAiText({
      system:
        "You triage product feedback from Slack. Reply with JSON only: " +
        '{"title":"a specific request title","board_id":"one of the supplied board ids"}. ' +
        "Never invent a board id. Keep the title under 120 characters.",
      prompt:
        `Slack author: ${input.authorName}\n\n` +
        `Boards:\n${choices
          .map((board) => `- ${board.id}: ${board.name}${board.description ? ` — ${board.description}` : ""}`)
          .join("\n")}\n\n` +
        `Message:\n${text}`,
      temperature: 0.2,
      maxTokens: 300,
      responseFormat: "json",
    });
    const ai = parseAiChoice(raw, choices, input.authorName);
    if (ai) {
      return {
        boardId: ai.board.id,
        boardName: ai.board.name,
        title: ai.title,
        body: text,
        category: categoryFor(text),
        usedAi: true,
      };
    }
  } catch (error) {
    logEvent("debug", "slack.suggestion_fallback", {
      error: serializeError(error),
    });
  }

  return {
    boardId: fallback.board.id,
    boardName: fallback.board.name,
    title: fallback.title,
    body: text,
    category: categoryFor(text),
    usedAi: false,
  };
}
