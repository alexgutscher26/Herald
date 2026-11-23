import type { NextRequest } from "next/server";
import { z } from "zod";

import {
  deleteScimUser,
  getScimUser,
  patchScimUser,
  ScimError,
  type ScimPatch,
} from "@/features/enterprise/scim";
import {
  authorizeScimRequest,
  scimError,
  scimJson,
} from "@/features/enterprise/scim-http";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  schemas: z.array(z.string()).optional(),
  Operations: z
    .array(
      z.object({
        op: z.string(),
        path: z.string().optional(),
        value: z.unknown().optional(),
      }),
    )
    .min(1),
});

function applyOperation(patch: ScimPatch, path: string | undefined, value: unknown): void {
  const name = (path ?? "").toLowerCase();
  if (name === "active" || name === "urn:ietf:params:scim:schemas:core:2.0:user:active") {
    if (typeof value !== "boolean") throw new ScimError(400, "active must be a boolean.");
    patch.active = value;
    return;
  }
  if (name === "username") {
    if (typeof value !== "string") throw new ScimError(400, "userName must be a string.");
    patch.userName = value;
    return;
  }
  if (name === "name.givenname") {
    if (typeof value !== "string") throw new ScimError(400, "givenName must be a string.");
    patch.givenName = value;
    return;
  }
  if (name === "name.familyname") {
    if (typeof value !== "string") throw new ScimError(400, "familyName must be a string.");
    patch.familyName = value;
    return;
  }
  if (name === "roles") {
    const roleValue = Array.isArray(value)
      ? (value[0] as { value?: unknown } | undefined)?.value
      : (value as { value?: unknown } | undefined)?.value;
    if (typeof roleValue !== "string") throw new ScimError(400, "roles[0].value is required.");
    patch.role = roleValue;
    return;
  }
  if (name === "") {
    // Entra ID sends a pathless operation with an object of attributes.
    if (!value || typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    if (typeof object.active === "boolean") patch.active = object.active;
    if (typeof object.userName === "string") patch.userName = object.userName;
    if (typeof object.role === "string") patch.role = object.role;
    const nameObject = object.name as Record<string, unknown> | undefined;
    if (typeof nameObject?.givenName === "string") patch.givenName = nameObject.givenName;
    if (typeof nameObject?.familyName === "string") patch.familyName = nameObject.familyName;
    return;
  }
  throw new ScimError(400, `Unsupported PATCH path: ${path}`, "invalidPath");
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceSlug: string; memberId: string }> },
) {
  const { workspaceSlug, memberId } = await params;
  const auth = await authorizeScimRequest(request, workspaceSlug);
  if ("response" in auth) return auth.response;

  const user = await getScimUser(auth.workspaceId, memberId, workspaceSlug);
  if (!user) return scimError(404, "User not found.");
  return scimJson(user);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceSlug: string; memberId: string }> },
) {
  const { workspaceSlug, memberId } = await params;
  const auth = await authorizeScimRequest(request, workspaceSlug);
  if ("response" in auth) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return scimError(400, "The request body must be JSON.", "invalidSyntax");
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return scimError(400, parsed.error.issues[0]?.message ?? "Invalid PATCH request.");
  }

  try {
    const patch: ScimPatch = {};
    for (const operation of parsed.data.Operations) {
      const op = operation.op.toLowerCase();
      if (op !== "replace" && op !== "add") {
        return scimError(400, `Unsupported operation: ${operation.op}`, "invalidSyntax");
      }
      applyOperation(patch, operation.path, operation.value);
    }
    return scimJson(
      await patchScimUser({
        workspaceId: auth.workspaceId,
        workspaceSlug,
        memberId,
        patch,
        actorUserId: auth.actorUserId,
      }),
    );
  } catch (error) {
    if (error instanceof ScimError) {
      return scimError(error.status, error.message, error.scimType);
    }
    console.error("[scim] patch user failed", error);
    return scimError(500, "Could not update the user.");
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceSlug: string; memberId: string }> },
) {
  const { workspaceSlug, memberId } = await params;
  const auth = await authorizeScimRequest(request, workspaceSlug);
  if ("response" in auth) return auth.response;

  try {
    const deleted = await deleteScimUser(auth.workspaceId, memberId, auth.actorUserId);
    if (!deleted) return scimError(404, "User not found.");
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof ScimError) {
      return scimError(error.status, error.message, error.scimType);
    }
    console.error("[scim] delete user failed", error);
    return scimError(500, "Could not remove the user.");
  }
}
