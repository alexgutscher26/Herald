import type { NextRequest } from "next/server";
import { z } from "zod";

import {
  ScimError,
  createScimUser,
  findScimUserByEmail,
  listScimUsers,
} from "@/features/enterprise/scim";
import {
  authorizeScimRequest,
  scimError,
  scimJson,
} from "@/features/enterprise/scim-http";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  userName: z.string().min(3).max(320).optional(),
  name: z
    .object({
      givenName: z.string().max(120).optional(),
      familyName: z.string().max(120).optional(),
    })
    .optional(),
  emails: z
    .array(z.object({ value: z.string().min(3), primary: z.boolean().optional() }))
    .max(5)
    .optional(),
  active: z.boolean().optional(),
  roles: z.array(z.object({ value: z.string() })).max(5).optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceSlug: string }> },
) {
  const { workspaceSlug } = await params;
  const auth = await authorizeScimRequest(request, workspaceSlug);
  if ("response" in auth) return auth.response;

  const filter = request.nextUrl.searchParams.get("filter");
  if (filter) {
    const match = /^\s*userName\s+eq\s+"(.+)"\s*$/i.exec(filter);
    if (!match?.[1]) {
      return scimError(400, "Only `userName eq \"...\"` filters are supported.", "invalidFilter");
    }
    const found = await findScimUserByEmail(auth.workspaceId, match[1], workspaceSlug);
    return scimJson({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: found ? 1 : 0,
      startIndex: 1,
      itemsPerPage: found ? 1 : 0,
      Resources: found ? [found] : [],
    });
  }

  return scimJson(await listScimUsers(auth.workspaceId, workspaceSlug));
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceSlug: string }> },
) {
  const { workspaceSlug } = await params;
  const auth = await authorizeScimRequest(request, workspaceSlug);
  if ("response" in auth) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return scimError(400, "The request body must be JSON.", "invalidSyntax");
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return scimError(400, parsed.error.issues[0]?.message ?? "Invalid SCIM user.", "invalidValue");
  }

  const userName = parsed.data.userName ?? parsed.data.emails?.[0]?.value;
  if (!userName) {
    return scimError(400, "userName or a primary email is required.", "invalidValue");
  }

  try {
    const created = await createScimUser({
      workspaceId: auth.workspaceId,
      workspaceSlug,
      user: {
        userName,
        givenName: parsed.data.name?.givenName,
        familyName: parsed.data.name?.familyName,
        active: parsed.data.active,
        role: parsed.data.roles?.[0]?.value,
      },
    });
    return scimJson(created, 201);
  } catch (error) {
    if (error instanceof ScimError) {
      return scimError(error.status, error.message, error.scimType);
    }
    console.error("[scim] create user failed", error);
    return scimError(500, "Could not create the user.");
  }
}
