import type { NextRequest } from "next/server";
import { z } from "zod";

import { listActiveCustomFields } from "@/db/queries/custom-fields";
import { publicSurfaceEnabled } from "@/features/entitlements/entitlements";
import { parseCustomFieldValues } from "@/features/feedback/custom-fields";
import {
  readCustomerSessionCookie,
  rejectCrossOrigin,
  setCustomerSessionCookie,
} from "@/features/customer-session/http";
import {
  consumeRateLimit,
  rateLimitKey,
} from "@/features/customer-session/rate-limit";
import {
  createGuestCustomerSession,
  findActiveCustomerSession,
  identifyCustomer,
} from "@/features/customer-session/session";
import { queuePostSuggestions } from "@/features/juno/auxiliary";
import { publicJson } from "@/features/public/actor";
import { trackAnalyticsEvent } from "@/features/analytics/track";
import { applyIntakeTraits } from "@/features/conversations/support-settings";
import { createPublicRequest, MAX_ATTACHMENTS } from "@/features/public/engagement";
import { publicRequestPath } from "@/features/public/paths";
import { resolvePublicBoard } from "@/features/public/resolver";
import { reportError } from "@/lib/error-report";
import { isValidEmail } from "@/lib/email";

/**
 * Submit a public request.
 *
 * Accepts multipart form data so a submission and its attachments arrive
 * together. A visitor without a session gets a guest session when the board
 * allows it; supplying an email identifies that session first, which is what a
 * board with guest posting disabled requires. The response reports whether the
 * request is live or awaiting moderation, so the author never loses a form
 * without knowing what happened to it.
 */

export const dynamic = "force-dynamic";

const TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const titleSchema = z.string().trim().min(3, "Give the request a title.").max(140);
const bodySchema = z
  .string()
  .trim()
  .min(10, "Describe the request in a little more detail.")
  .max(5_000);

const formSchema = z.object({
  title: titleSchema,
  body: bodySchema,
  category: z.enum(["feature_request", "bug", "improvement", "question"]),
  privacy: z.enum(["public", "author", "company"]).default("public"),
  email: z.string().trim().max(254).optional(),
  name: z.string().trim().max(120).optional(),
});

const splitDraftSchema = z.object({
  title: titleSchema,
  body: bodySchema,
});

const splitsSchema = z.array(splitDraftSchema).max(3);

type Params = {
  workspaceSlug: string;
  productSlug: string;
  boardSlug: string;
};

function fieldError(field: string, error: string): Response {
  return publicJson({ error, field }, 400);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<Params> },
): Promise<Response> {
  const params = await context.params;

  try {
    const crossOrigin = rejectCrossOrigin(request);
    if (crossOrigin) return crossOrigin;

    const tenant = await resolvePublicBoard(params);
    if (!tenant || !publicSurfaceEnabled(tenant.workspace.plan)) {
      return publicJson({ error: "Board not found." }, 404);
    }

    const form = await request.formData().catch(() => null);
    if (!form) return publicJson({ error: "The form could not be read." }, 400);

    const parsed = formSchema.safeParse({
      title: form.get("title") ?? "",
      body: form.get("body") ?? "",
      category: form.get("category") ?? "",
      privacy: form.get("privacy") ?? "public",
      email: form.get("email") ?? undefined,
      name: form.get("name") ?? undefined,
    });

    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return fieldError(
        issue?.path[0] === "title" || issue?.path[0] === "body"
          ? String(issue.path[0])
          : "form",
        issue?.message ?? "Check the form and try again.",
      );
    }

    const attachments = form
      .getAll("attachments")
      .filter((entry): entry is File => typeof entry !== "string" && entry.size > 0);

    if (attachments.length > MAX_ATTACHMENTS) {
      return fieldError("attachments", `Attach at most ${MAX_ATTACHMENTS} files.`);
    }

    const totalBytes = attachments.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > TOTAL_ATTACHMENT_BYTES) {
      return fieldError("attachments", "The attachments are too large together.");
    }

    const email = parsed.data.email?.trim() ?? "";
    if (email !== "" && !isValidEmail(email)) {
      return fieldError("email", "Enter a valid email address.");
    }

    // Custom fields are product-wide, so their definitions are resolved from
    // the tenant the board belongs to — never from a client-supplied id.
    const customFieldDefinitions = await listActiveCustomFields(tenant.product.id);
    const rawCustomFields = form.get("custom_fields");
    let customFieldInput: Record<string, unknown> = {};
    if (typeof rawCustomFields === "string" && rawCustomFields.trim() !== "") {
      try {
        const decoded: unknown = JSON.parse(rawCustomFields);
        if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
          return fieldError("form", "The custom fields could not be read.");
        }
        customFieldInput = decoded as Record<string, unknown>;
      } catch {
        return fieldError("form", "The custom fields could not be read.");
      }
    }

    const parsedCustomFields = parseCustomFieldValues(
      customFieldDefinitions,
      customFieldInput,
    );
    if (!parsedCustomFields.ok) {
      const [key, message] = Object.entries(parsedCustomFields.errors)[0] ?? [
        "form",
        "Check the custom fields.",
      ];
      return fieldError(key, message);
    }

    const rewriteAccepted = form.get("rewrite_accepted") === "1";
    let originalTitle: string | null = null;
    let originalBody: string | null = null;
    if (rewriteAccepted) {
      const parsedOriginal = z
        .object({ title: titleSchema, body: bodySchema })
        .safeParse({
          title: form.get("original_title") ?? "",
          body: form.get("original_body") ?? "",
        });
      if (!parsedOriginal.success) {
        return fieldError("form", "The original wording could not be read.");
      }
      if (
        parsedOriginal.data.title !== parsed.data.title ||
        parsedOriginal.data.body !== parsed.data.body
      ) {
        originalTitle = parsedOriginal.data.title;
        originalBody = parsedOriginal.data.body;
      }
    }

    let splitDrafts: { title: string; body: string }[] = [];
    const rawSplits = form.get("splits");
    if (typeof rawSplits === "string" && rawSplits.trim() !== "") {
      try {
        const parsedSplits = splitsSchema.safeParse(JSON.parse(rawSplits));
        if (!parsedSplits.success) {
          return fieldError("form", "The split requests could not be read.");
        }
        splitDrafts = parsedSplits.data;
      } catch {
        return fieldError("form", "The split requests could not be read.");
      }
    }

    const customFieldValues = customFieldDefinitions.flatMap((field) => {
      if (!parsedCustomFields.values.has(field.id)) return [];
      const value = parsedCustomFields.values.get(field.id) as string | number;
      return [
        {
          fieldId: field.id,
          textValue:
            field.type === "text" || field.type === "select" ? String(value) : null,
          numberValue: field.type === "number" ? Number(value) : null,
          dateValue: field.type === "date" ? String(value) : null,
        },
      ];
    });

    const active = await findActiveCustomerSession(readCustomerSessionCookie(request));
    let working =
      active && active.session.workspaceId === tenant.workspace.id ? active : null;
    let cookieValue: string | null = null;

    if (!working) {
      if (email === "" && !tenant.board.guestPosting) {
        return publicJson(
          { error: "Add your email address to submit a request on this board.", field: "email" },
          401,
        );
      }
      const created = await createGuestCustomerSession(tenant.workspace.id);
      working = created.active;
      cookieValue = created.cookieValue;
    }

    if (!working) {
      return publicJson({ error: "Could not start a session." }, 500);
    }

    if (email !== "") {
      const identified = await identifyCustomer(working, {
        email,
        name: parsed.data.name?.trim() || undefined,
      });

      if (!identified.ok) {
        if (identified.reason === "banned") {
          return publicJson({ error: "This account cannot submit requests." }, 403);
        }
        return fieldError(
          "email",
          "That email is already in use here. Try the address you used before.",
        );
      }

      working = identified.active;
      cookieValue = identified.cookieValue;
    }

    if (!tenant.board.guestPosting && working.session.guest) {
      return publicJson(
        { error: "Add your email address to submit a request on this board.", field: "email" },
        401,
      );
    }

    // Intake is optional by contract. Malformed JSON is treated as no answer,
    // and a failed trait merge never blocks the submission itself.
    let intakeAnswers: unknown = {};
    const rawIntake = form.get("intake");
    if (typeof rawIntake === "string" && rawIntake.trim() !== "") {
      try {
        intakeAnswers = JSON.parse(rawIntake);
      } catch {
        intakeAnswers = {};
      }
    }
    const limit = await consumeRateLimit({
      bucket: rateLimitKey(request, "public:submit"),
      limit: 10,
      windowSeconds: 60 * 60,
    });
    if (!limit.allowed) {
      return publicJson(
        { error: "Too many submissions. Please try again later." },
        429,
      );
    }

    const files = [];
    for (const file of attachments) {
      files.push({
        fileName: file.name,
        mimeType: file.type,
        body: new Uint8Array(await file.arrayBuffer()),
      });
    }

    const result = await createPublicRequest({
      tenant,
      customerId: working.customer.id,
      customerName: working.customer.name,
      title: parsed.data.title,
      body: parsed.data.body,
      category: parsed.data.category,
      privacy: parsed.data.privacy,
      files,
      customFieldValues,
      originalTitle,
      originalBody,
    });

    if (!result.ok) {
      return publicJson(
        { error: result.error, ...(result.field ? { field: result.field } : {}) },
        result.status,
      );
    }

    // Splits are created only after the main request exists, and each one keeps
    // provenance back to it. A failed split never rolls back the submission the
    // customer already made.
    const splitIds: string[] = [];
    for (const draft of splitDrafts) {
      const split = await createPublicRequest({
        tenant,
        customerId: working.customer.id,
        customerName: working.customer.name,
        title: draft.title,
        body: draft.body,
        category: parsed.data.category,
        privacy: parsed.data.privacy,
        files: [],
        customFieldValues: [],
        splitFromId: result.id,
      });
      if (split.ok) splitIds.push(split.id);
    }

    // Only a live submission carries its answers; a rejected or rate-limited
    // one must not leave traits behind. The merge stays best-effort so a
    // failure cannot turn a successful submission into an error.
    await applyIntakeTraits({
      productId: tenant.product.id,
      channel: "board",
      boardId: tenant.board.id,
      customerId: working.customer.id,
      answers: intakeAnswers,
    }).catch(() => undefined);

    // Auxiliary AI is optional and best-effort: the submission succeeds even
    // if the queue is down. It never applies a tag or merges anything.
    await queuePostSuggestions({
      productId: tenant.product.id,
      feedbackPostId: result.id,
    });

    const response = publicJson(
      {
        id: result.id,
        status: result.status,
        splitCount: splitIds.length,
        path: publicRequestPath(
          tenant.workspace.slug,
          tenant.product.slug,
          tenant.board.slug,
          result.id,
        ),
      },
      201,
    );

    await trackAnalyticsEvent({
      workspaceId: tenant.workspace.id,
      productId: tenant.product.id,
      boardId: tenant.board.id,
      feedbackPostId: result.id,
      type: "submission",
    });

    if (cookieValue) setCustomerSessionCookie(response, cookieValue);
    return response;
  } catch (error) {
    await reportError(error, { route: "public.request.create" }, "public.submit_failed");
    return publicJson({ error: "Could not submit the request." }, 500);
  }
}
