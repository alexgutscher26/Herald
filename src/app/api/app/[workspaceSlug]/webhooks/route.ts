import { NextResponse } from "next/server";
import { z } from "zod";

import { WEBHOOK_EVENTS } from "@/db/schema";
import { authorizeWorkspaceApi } from "@/features/app-api/auth";
import { checkWorkspaceLimit } from "@/features/entitlements/entitlements";
import { createWebhook, listWebhooks } from "@/features/webhooks/service";

/**
 * Workspace webhook management.
 *
 * A webhook is created by an owner/admin (`settings:manage`); the signing
 * secret is returned once and never listed again. Delivery history and replay
 * live under the webhook's own sub-routes.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "private, no-store" } as const;

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().min(1).max(2_000),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length).optional(),
});

function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "body";
    result[key] = [...(result[key] ?? []), issue.message];
  }
  return result;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceSlug: string }> },
): Promise<NextResponse> {
  const { workspaceSlug } = await context.params;
  const authorized = await authorizeWorkspaceApi({
    request,
    workspaceSlug,
    permission: "settings:manage",
  });
  if (!authorized.ok) return authorized.response;

  const hooks = await listWebhooks(authorized.workspace.id);
  return NextResponse.json({ webhooks: hooks }, { headers: NO_STORE });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceSlug: string }> },
): Promise<NextResponse> {
  const { workspaceSlug } = await context.params;
  const authorized = await authorizeWorkspaceApi({
    request,
    workspaceSlug,
    permission: "settings:manage",
    mutation: true,
  });
  if (!authorized.ok) return authorized.response;

  const json: unknown = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Check the webhook fields.", fieldErrors: fieldErrors(parsed.error) },
      { status: 400, headers: NO_STORE },
    );
  }

  const limit = await checkWorkspaceLimit(authorized.workspace.id, "integrations");
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error:
          limit.limit === null
            ? "Your plan cannot add another integration."
            : `Your plan allows ${limit.limit} integration${limit.limit === 1 ? "" : "s"}. Upgrade to add more.`,
      },
      { status: 403, headers: NO_STORE },
    );
  }

  const result = await createWebhook({
    workspaceId: authorized.workspace.id,
    userId: authorized.user.id,
    name: parsed.data.name,
    url: parsed.data.url,
    events: parsed.data.events ?? [...WEBHOOK_EVENTS],
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, fieldErrors: { url: [result.error] } },
      { status: 400, headers: NO_STORE },
    );
  }

  return NextResponse.json(
    {
      webhook: {
        id: result.id,
        name: parsed.data.name,
        url: parsed.data.url,
        events: parsed.data.events ?? WEBHOOK_EVENTS,
        active: true,
      },
      secret: result.secret,
      signing: {
        header: "x-herald-signature",
        timestamp_header: "x-herald-timestamp",
        algorithm: "HMAC-SHA256 over `${timestamp}.${rawBody}`, sent as `v1=<hex>`",
      },
    },
    { status: 201, headers: NO_STORE },
  );
}
