import "server-only";

import { recordAiUsage } from "@/features/observability/ai-usage";
import { getAiConfig } from "@/lib/env";
import { logEvent, serializeError } from "@/lib/logger";
import { currentRequestId } from "@/lib/observability/context";
import { withSpan } from "@/lib/observability/tracing";

/**
 * Minimal OpenAI-compatible chat provider.
 *
 * The endpoint and model are deployment configuration, not client input, so a
 * workspace can point this at any compatible provider without a code change.
 * The key never leaves the server. Only the `choices[0].message.content`
 * string is accepted; provider errors never reach the browser verbatim.
 */

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 40_000;

export class AiNotConfiguredError extends Error {
  constructor() {
    super(
      "AI drafting is not configured. Set AI_API_URL and AI_MODEL (and AI_API_KEY when the provider requires one).",
    );
    this.name = "AiNotConfiguredError";
  }
}

export class AiProviderError extends Error {
  constructor(message = "AI drafting is temporarily unavailable. Please try again.") {
    super(message);
    this.name = "AiProviderError";
  }
}

export type GenerateTextInput = {
  system: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  /**
   * Ask for a JSON object (OpenAI `json_object` mode). Callers whose output is
   * parsed as JSON set this: without it a small model tends to answer with
   * prose or YAML-style blocks that no parser can accept.
   */
  responseFormat?: "json";
  /** Cost attribution; omitted by callers that only need the draft. */
  workspaceId?: string | null;
  productId?: string | null;
  feature?: string;
};

function chatCompletionsUrl(base: string): string {
  const trimmed = base.replace(/\/+$/, "");
  return trimmed.endsWith("/chat/completions")
    ? trimmed
    : `${trimmed}/chat/completions`;
}

export async function generateAiText(input: GenerateTextInput): Promise<string> {
  const config = getAiConfig();
  if (!config) throw new AiNotConfiguredError();

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    config.AI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    const requestId = currentRequestId();
    const response = await withSpan(
      "ai.provider.generate",
      { model: config.AI_MODEL, feature: input.feature ?? "ai" },
      () =>
        fetch(chatCompletionsUrl(config.AI_API_URL), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.AI_API_KEY
          ? { authorization: `Bearer ${config.AI_API_KEY}` }
          : {}),
        ...(requestId ? { "x-request-id": requestId } : {}),
      },
      body: JSON.stringify({
        model: config.AI_MODEL,
        temperature: input.temperature ?? 0.4,
        max_tokens: input.maxTokens ?? 1_400,
        ...(input.responseFormat === "json"
          ? { response_format: { type: "json_object" } }
          : {}),
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.prompt },
        ],
      }),
      signal: controller.signal,
      cache: "no-store",
        }),
    );

    if (!response.ok) {
      logEvent("error", "ai.generate_failed", {
        status: response.status,
        model: config.AI_MODEL,
      });
      throw new AiProviderError();
    }

    const payload = (await response.json().catch(() => null)) as
      | {
          choices?: { message?: { content?: unknown } }[];
          usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
        }
      | null;
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      logEvent("error", "ai.generate_empty", {
        model: config.AI_MODEL,
      });
      throw new AiProviderError("The AI provider returned an empty draft. Please try again.");
    }

    // Cost telemetry is best-effort and stores token counts only, never the
    // prompt or completion.
    void recordAiUsage({
      model: config.AI_MODEL,
      promptTokens:
        typeof payload?.usage?.prompt_tokens === "number"
          ? payload.usage.prompt_tokens
          : 0,
      completionTokens:
        typeof payload?.usage?.completion_tokens === "number"
          ? payload.usage.completion_tokens
          : 0,
      feature: input.feature,
      workspaceId: input.workspaceId,
      productId: input.productId,
    });

    return content.trim().slice(0, MAX_OUTPUT_CHARS);
  } catch (error) {
    if (error instanceof AiProviderError || error instanceof AiNotConfiguredError) throw error;

    logEvent("error", "ai.generate_failed", {
      model: config.AI_MODEL,
      error: serializeError(error),
    });
    throw new AiProviderError();
  } finally {
    clearTimeout(timeout);
  }
}
