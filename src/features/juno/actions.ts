"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { ActionResult } from "@/features/live/action-result";
import { authorizeProductAction } from "@/features/live/action-auth";

import {
  addEvalCase,
  removeEvalCase,
  runJunoEvaluation,
} from "./evaluation";
import { getJunoAnswerForEvaluation, rateJunoAnswer } from "./inspection";
import { dryRunKnowledgeRetrieval, type JunoDryRunResult } from "./dry-run";
import { completeKnowledgeTask } from "./knowledge-tasks";
import { isAgentActionKind, saveAgentActionSetting } from "./agent-actions";
import { resolveDuplicateReview } from "./duplicate-review";
import { handToJuno } from "./schedule";
import { saveJunoSettings } from "./settings";
import {
  createUploadSource,
  createUrlSource,
  dismissSourceChange,
  pauseSource,
  recrawlSource,
  removeSource,
  replaceUploadSource,
  resumeSource,
  saveSourceSettings,
} from "./sources";
import { extractPdfText } from "./pdf";
import { isPdfUpload, MAX_DOCUMENT_BYTES } from "./text";

/**
 * Juno server actions.
 *
 * Every form re-checks `juno:manage`; the page's `settings:manage` guard is not
 * the authorization boundary. Errors come back through the URL so the page
 * stays usable without client JavaScript, and no raw provider message reaches
 * the browser.
 */

function settingsPath(workspaceSlug: string, productSlug: string): string {
  return `/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
    productSlug,
  )}/settings`;
}

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function checked(formData: FormData, key: string): boolean {
  const value = formData.get(key);
  return value === "on" || value === "true";
}

function integer(formData: FormData, key: string, fallback: number): number {
  const parsed = Number.parseInt(text(formData, key), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function decimal(formData: FormData, key: string, fallback: number): number {
  const parsed = Number.parseFloat(text(formData, key));
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function uploadedFile(
  formData: FormData,
  key: string,
): Promise<{ filename: string; mimeType: string; content: string } | { error: string }> {
  const file = formData.get(key);
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a document to upload." };
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return { error: "Documents must be 10 MB or smaller." };
  }
  if (isPdfUpload(file.name, file.type)) {
    try {
      const content = await extractPdfText(await file.arrayBuffer());
      return { filename: file.name, mimeType: file.type || "application/pdf", content };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "That PDF could not be read.",
      };
    }
  }
  const content = await file.text();
  return { filename: file.name, mimeType: file.type, content };
}

export async function saveJunoSettingsAction(formData: FormData): Promise<void> {
  const workspaceSlug = text(formData, "workspaceSlug");
  const productSlug = text(formData, "productSlug");
  const path = settingsPath(workspaceSlug, productSlug);

  const authorized = await authorizeProductAction(workspaceSlug, productSlug, "juno:manage");
  if ("error" in authorized) {
    redirect(`${path}?error=${encodeURIComponent(authorized.error.error)}`);
  }

  const result = await saveJunoSettings({
    productId: authorized.context.product.id,
    enabled: checked(formData, "enabled"),
    duplicateMode: text(formData, "duplicateMode") || "assisted",
    submissionAssistantEnabled: checked(formData, "submissionAssistantEnabled"),
    tone: text(formData, "tone"),
    replyLength: text(formData, "replyLength"),
    formality: text(formData, "formality"),
    emoji: checked(formData, "emoji"),
    language: text(formData, "language") || "auto",
    model: text(formData, "model"),
    confidenceFloor: decimal(formData, "confidenceFloor", 0.35),
    dailyBudgetCents: integer(formData, "dailyBudgetCents", 100),
    autoResolveChatMinutes: integer(formData, "autoResolveChatMinutes", 30),
    autoResolveEmailMinutes: integer(formData, "autoResolveEmailMinutes", 4320),
  });

  if (!result.ok) {
    redirect(`${path}?error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath(path);
  redirect(`${path}?saved=juno`);
}

export async function addKnowledgeUploadAction(formData: FormData): Promise<void> {
  const workspaceSlug = text(formData, "workspaceSlug");
  const productSlug = text(formData, "productSlug");
  const path = settingsPath(workspaceSlug, productSlug);

  const authorized = await authorizeProductAction(workspaceSlug, productSlug, "juno:manage");
  if ("error" in authorized) {
    redirect(`${path}?error=${encodeURIComponent(authorized.error.error)}`);
  }

  const upload = await uploadedFile(formData, "file");
  if ("error" in upload) {
    redirect(`${path}?error=${encodeURIComponent(upload.error)}`);
  }

  const result = await createUploadSource({
    workspaceId: authorized.context.workspace.id,
    productId: authorized.context.product.id,
    userId: authorized.context.user.id,
    name: text(formData, "name") || upload.filename.replace(/\.[^.]+$/, ""),
    filename: upload.filename,
    mimeType: upload.mimeType,
    content: upload.content,
  });

  if (!result.ok) {
    redirect(`${path}?error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath(path);
  redirect(`${path}?saved=knowledge`);
}

export async function addKnowledgeUrlAction(formData: FormData): Promise<void> {
  const workspaceSlug = text(formData, "workspaceSlug");
  const productSlug = text(formData, "productSlug");
  const path = settingsPath(workspaceSlug, productSlug);

  const authorized = await authorizeProductAction(workspaceSlug, productSlug, "juno:manage");
  if ("error" in authorized) {
    redirect(`${path}?error=${encodeURIComponent(authorized.error.error)}`);
  }

  const result = await createUrlSource({
    workspaceId: authorized.context.workspace.id,
    productId: authorized.context.product.id,
    userId: authorized.context.user.id,
    name: text(formData, "name"),
    url: text(formData, "url"),
  });

  if (!result.ok) {
    redirect(`${path}?error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath(path);
  redirect(`${path}?saved=knowledge`);
}

const sourceSchema = z.object({
  workspaceSlug: z.string().min(1),
  productSlug: z.string().min(1),
  sourceId: z.uuid(),
});

function parseSource(formData: FormData) {
  return sourceSchema.safeParse({
    workspaceSlug: text(formData, "workspaceSlug"),
    productSlug: text(formData, "productSlug"),
    sourceId: text(formData, "sourceId"),
  });
}

export async function recrawlKnowledgeAction(formData: FormData): Promise<void> {
  const parsed = parseSource(formData);
  if (!parsed.success) redirect("/app");
  const path = settingsPath(parsed.data.workspaceSlug, parsed.data.productSlug);

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "juno:manage",
  );
  if ("error" in authorized) {
    redirect(`${path}?error=${encodeURIComponent(authorized.error.error)}`);
  }

  const result = await recrawlSource({
    productId: authorized.context.product.id,
    sourceId: parsed.data.sourceId,
  });
  if (!result.ok) redirect(`${path}?error=${encodeURIComponent(result.error)}`);

  revalidatePath(path);
  redirect(`${path}?saved=knowledge`);
}

export async function saveKnowledgeSourceSettingsAction(formData: FormData): Promise<void> {
  const parsed = parseSource(formData);
  if (!parsed.success) redirect("/app");
  const path = settingsPath(parsed.data.workspaceSlug, parsed.data.productSlug);

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "juno:manage",
  );
  if ("error" in authorized) {
    redirect(`${path}?error=${encodeURIComponent(authorized.error.error)}`);
  }

  const result = await saveSourceSettings({
    productId: authorized.context.product.id,
    sourceId: parsed.data.sourceId,
    visibility: text(formData, "visibility"),
    recrawlIntervalHours: integer(formData, "recrawlIntervalHours", 0),
  });
  if (!result.ok) redirect(`${path}?error=${encodeURIComponent(result.error)}`);

  revalidatePath(path);
  redirect(`${path}?saved=knowledge`);
}

export async function dismissKnowledgeChangeAction(formData: FormData): Promise<void> {
  const parsed = parseSource(formData);
  if (!parsed.success) redirect("/app");
  const path = settingsPath(parsed.data.workspaceSlug, parsed.data.productSlug);

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "juno:manage",
  );
  if ("error" in authorized) {
    redirect(`${path}?error=${encodeURIComponent(authorized.error.error)}`);
  }

  const result = await dismissSourceChange({
    productId: authorized.context.product.id,
    sourceId: parsed.data.sourceId,
  });
  if (!result.ok) redirect(`${path}?error=${encodeURIComponent(result.error)}`);

  revalidatePath(path);
  redirect(`${path}?saved=knowledge`);
}

export async function replaceKnowledgeUploadAction(formData: FormData): Promise<void> {
  const parsed = parseSource(formData);
  if (!parsed.success) redirect("/app");
  const path = settingsPath(parsed.data.workspaceSlug, parsed.data.productSlug);

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "juno:manage",
  );
  if ("error" in authorized) {
    redirect(`${path}?error=${encodeURIComponent(authorized.error.error)}`);
  }

  const upload = await uploadedFile(formData, "file");
  if ("error" in upload) {
    redirect(`${path}?error=${encodeURIComponent(upload.error)}`);
  }

  const result = await replaceUploadSource({
    productId: authorized.context.product.id,
    sourceId: parsed.data.sourceId,
    filename: upload.filename,
    mimeType: upload.mimeType,
    content: upload.content,
  });
  if (!result.ok) redirect(`${path}?error=${encodeURIComponent(result.error)}`);

  revalidatePath(path);
  redirect(`${path}?saved=knowledge`);
}

async function changeSource(
  formData: FormData,
  operation: "pause" | "resume" | "remove",
): Promise<void> {
  const parsed = parseSource(formData);
  if (!parsed.success) redirect("/app");
  const path = settingsPath(parsed.data.workspaceSlug, parsed.data.productSlug);

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "juno:manage",
  );
  if ("error" in authorized) {
    redirect(`${path}?error=${encodeURIComponent(authorized.error.error)}`);
  }

  const input = {
    productId: authorized.context.product.id,
    sourceId: parsed.data.sourceId,
  };
  const result =
    operation === "pause"
      ? await pauseSource(input)
      : operation === "resume"
        ? await resumeSource(input)
        : await removeSource(input);

  if (!result.ok) redirect(`${path}?error=${encodeURIComponent(result.error)}`);

  revalidatePath(path);
  redirect(`${path}?saved=knowledge`);
}

export async function pauseKnowledgeAction(formData: FormData): Promise<void> {
  await changeSource(formData, "pause");
}

export async function resumeKnowledgeAction(formData: FormData): Promise<void> {
  await changeSource(formData, "resume");
}

export async function removeKnowledgeAction(formData: FormData): Promise<void> {
  await changeSource(formData, "remove");
}

export async function addJunoEvalCaseAction(formData: FormData): Promise<void> {
  const workspaceSlug = text(formData, "workspaceSlug");
  const productSlug = text(formData, "productSlug");
  const path = settingsPath(workspaceSlug, productSlug);

  const authorized = await authorizeProductAction(workspaceSlug, productSlug, "juno:manage");
  if ("error" in authorized) {
    redirect(`${path}?error=${encodeURIComponent(authorized.error.error)}`);
  }

  const result = await addEvalCase({
    productId: authorized.context.product.id,
    userId: authorized.context.user.id,
    question: text(formData, "question"),
    expectedKeywords: text(formData, "expectedKeywords").split(","),
    expectHandoff: checked(formData, "expectHandoff"),
  });
  if (!result.ok) redirect(`${path}?error=${encodeURIComponent(result.error)}`);

  revalidatePath(path);
  redirect(`${path}?saved=eval`);
}

export async function deleteJunoEvalCaseAction(formData: FormData): Promise<void> {
  const workspaceSlug = text(formData, "workspaceSlug");
  const productSlug = text(formData, "productSlug");
  const path = settingsPath(workspaceSlug, productSlug);

  const authorized = await authorizeProductAction(workspaceSlug, productSlug, "juno:manage");
  if ("error" in authorized) {
    redirect(`${path}?error=${encodeURIComponent(authorized.error.error)}`);
  }

  const parsed = z.uuid().safeParse(text(formData, "caseId"));
  if (!parsed.success) redirect(`${path}?error=${encodeURIComponent("That question id is not valid.")}`);

  const result = await removeEvalCase({
    productId: authorized.context.product.id,
    caseId: parsed.data,
  });
  if (!result.ok) redirect(`${path}?error=${encodeURIComponent(result.error)}`);

  revalidatePath(path);
  redirect(`${path}?saved=eval`);
}

export async function runJunoEvaluationAction(formData: FormData): Promise<void> {
  const workspaceSlug = text(formData, "workspaceSlug");
  const productSlug = text(formData, "productSlug");
  const path = settingsPath(workspaceSlug, productSlug);

  const authorized = await authorizeProductAction(workspaceSlug, productSlug, "juno:manage");
  if ("error" in authorized) {
    redirect(`${path}?error=${encodeURIComponent(authorized.error.error)}`);
  }

  const result = await runJunoEvaluation({
    productId: authorized.context.product.id,
    includeInternal: checked(formData, "includeInternal"),
  });
  if (!result.ok) redirect(`${path}?error=${encodeURIComponent(result.error)}`);

  revalidatePath(path);
  redirect(`${path}?saved=eval`);
}

export async function saveAgentActionAction(formData: FormData): Promise<void> {
  const workspaceSlug = text(formData, "workspaceSlug");
  const productSlug = text(formData, "productSlug");
  const path = settingsPath(workspaceSlug, productSlug);
  const action = text(formData, "action");

  const authorized = await authorizeProductAction(workspaceSlug, productSlug, "juno:manage");
  if ("error" in authorized) {
    redirect(`${path}?error=${encodeURIComponent(authorized.error.error)}`);
  }
  if (!isAgentActionKind(action)) {
    redirect(`${path}?error=${encodeURIComponent("Choose a supported action.")}`);
  }

  const result = await saveAgentActionSetting({
    workspaceId: authorized.context.workspace.id,
    productId: authorized.context.product.id,
    action,
    enabled: checked(formData, "enabled"),
    userId: authorized.context.user.id,
  });
  if (!result.ok) redirect(`${path}?error=${encodeURIComponent(result.error)}`);

  revalidatePath(path);
  redirect(`${path}?saved=agent-action`);
}

export async function rateJunoAnswerAction(formData: FormData): Promise<void> {
  const workspaceSlug = text(formData, "workspaceSlug");
  const productSlug = text(formData, "productSlug");
  const path = `/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
    productSlug,
  )}/conversations/answers`;
  const answerId = text(formData, "answerId");
  const rating = text(formData, "rating");

  const authorized = await authorizeProductAction(
    workspaceSlug,
    productSlug,
    "conversation:read",
  );
  if ("error" in authorized) {
    redirect(`${path}?error=${encodeURIComponent(authorized.error.error)}`);
  }
  if (rating !== "up" && rating !== "down") {
    redirect(`${path}?error=${encodeURIComponent("Choose a rating.")}`);
  }

  const result = await rateJunoAnswer({
    productId: authorized.context.product.id,
    answerId,
    userId: authorized.context.user.id,
    rating,
  });
  if (!result.ok) redirect(`${path}?error=${encodeURIComponent(result.error)}`);

  revalidatePath(path);
  revalidatePath(settingsPath(workspaceSlug, productSlug));
  redirect(`${path}?saved=rated`);
}

export async function completeJunoKnowledgeTaskAction(
  formData: FormData,
): Promise<void> {
  const workspaceSlug = text(formData, "workspaceSlug");
  const productSlug = text(formData, "productSlug");
  const path = settingsPath(workspaceSlug, productSlug);
  const parsed = z.uuid().safeParse(text(formData, "taskId"));
  if (!parsed.success) {
    redirect(`${path}?error=${encodeURIComponent("That task id is not valid.")}`);
  }

  const authorized = await authorizeProductAction(
    workspaceSlug,
    productSlug,
    "juno:manage",
  );
  if ("error" in authorized) {
    redirect(`${path}?error=${encodeURIComponent(authorized.error.error)}`);
  }

  const result = await completeKnowledgeTask({
    productId: authorized.context.product.id,
    taskId: parsed.data,
    userId: authorized.context.user.id,
  });
  if (!result.ok) redirect(`${path}?error=${encodeURIComponent(result.error)}`);

  revalidatePath(path);
  redirect(`${path}?saved=knowledge-task`);
}

export async function dryRunJunoRetrievalAction(input: {
  workspaceSlug: string;
  productSlug: string;
  query: string;
  includeInternal?: boolean;
}): Promise<ActionResult<JunoDryRunResult>> {
  const parsed = z
    .object({
      workspaceSlug: z.string().min(1),
      productSlug: z.string().min(1),
      query: z.string().trim().min(2).max(500),
      includeInternal: z.boolean().optional(),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Enter a question with at least two characters." };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "juno:manage",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const data = await dryRunKnowledgeRetrieval({
      productId: authorized.context.product.id,
      query: parsed.data.query,
      audience: parsed.data.includeInternal ? "internal" : "public",
    });
    return { ok: true, data };
  } catch (error) {
    console.error("[juno] dry run failed", error);
    return {
      ok: false,
      error:
        "Retrieval could not run. Check the embedding configuration and try again.",
    };
  }
}

export async function addJunoAnswerEvalAction(formData: FormData): Promise<void> {
  const workspaceSlug = text(formData, "workspaceSlug");
  const productSlug = text(formData, "productSlug");
  const path = `/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
    productSlug,
  )}/conversations/answers`;
  const answerId = text(formData, "answerId");

  const authorized = await authorizeProductAction(workspaceSlug, productSlug, "juno:manage");
  if ("error" in authorized) {
    redirect(`${path}?error=${encodeURIComponent(authorized.error.error)}`);
  }

  const answer = await getJunoAnswerForEvaluation({
    productId: authorized.context.product.id,
    answerId,
  });
  if (!answer) redirect(`${path}?error=${encodeURIComponent("That answer no longer exists.")}`);

  const result = await addEvalCase({
    productId: authorized.context.product.id,
    question: answer.question,
    expectedKeywords: text(formData, "expectedKeywords").split(","),
    expectHandoff: checked(formData, "expectHandoff"),
    userId: authorized.context.user.id,
  });
  if (!result.ok) redirect(`${path}?error=${encodeURIComponent(result.error)}`);

  revalidatePath(path);
  revalidatePath(settingsPath(workspaceSlug, productSlug));
  redirect(`${path}?saved=eval`);
}

export async function resolveDuplicateReviewAction(formData: FormData): Promise<void> {
  const workspaceSlug = text(formData, "workspaceSlug");
  const productSlug = text(formData, "productSlug");
  const path = `/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
    productSlug,
  )}/feedback/duplicates`;
  const decision = text(formData, "decision");

  const authorized = await authorizeProductAction(workspaceSlug, productSlug, "feedback:write");
  if ("error" in authorized) {
    redirect(`${path}?error=${encodeURIComponent(authorized.error.error)}`);
  }
  if (decision !== "merge" && decision !== "dismiss") {
    redirect(`${path}?error=${encodeURIComponent("Choose a review decision.")}`);
  }

  const result = await resolveDuplicateReview({
    productId: authorized.context.product.id,
    reviewId: text(formData, "reviewId"),
    userId: authorized.context.user.id,
    decision,
  });
  if (!result.ok) redirect(`${path}?error=${encodeURIComponent(result.error)}`);

  revalidatePath(`/app/${workspaceSlug}/${productSlug}`, "layout");
  revalidatePath(path);
  redirect(`${path}?saved=${decision}`);
}

export async function handToJunoAction(input: {
  workspaceSlug: string;
  productSlug: string;
  conversationId: string;
}): Promise<ActionResult<{ state: "active" }>> {
  const parsed = z
    .object({
      workspaceSlug: z.string().min(1),
      productSlug: z.string().min(1),
      conversationId: z.uuid(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "That conversation id is not valid." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "conversation:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await handToJuno({
      productId: authorized.context.product.id,
      conversationId: parsed.data.conversationId,
      userId: authorized.context.user.id,
    });
    if (!result.ok) return result;
    revalidatePath(
      `/app/${parsed.data.workspaceSlug}/${parsed.data.productSlug}`,
      "layout",
    );
    return { ok: true, data: result.data };
  } catch (error) {
    console.error("[juno] hand back failed", error);
    return { ok: false, error: "Could not hand that conversation back to Juno." };
  }
}
