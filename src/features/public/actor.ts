import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { publicSurfaceEnabled } from "@/features/entitlements/entitlements";
import {
  jsonError,
  readCustomerSessionCookie,
  rejectCrossOrigin,
} from "@/features/customer-session/http";
import {
  createGuestCustomerSession,
  findActiveCustomerSession,
} from "@/features/customer-session/session";

import { resolvePublicBoard } from "./resolver";
import type { ResolvedPublicBoard } from "./types";

/**
 * Resolve the actor for a public write.
 *
 * Same-origin is checked before anything else, then the board is resolved
 * (private and archived boards are the same 404 as unknown ones). A visitor
 * without a session gets a guest session only when the board allows guest
 * participation; otherwise the write is refused with a message that tells them
 * to add an email address first. `guestCookie` must be set on the response
 * when present.
 */
export type PublicActor = {
  tenant: ResolvedPublicBoard;
  customerId: string;
  customerName: string | null;
  identified: boolean;
  guestCookie: string | null;
};

export type PublicActorResult =
  | { ok: true; actor: PublicActor }
  | { ok: false; response: NextResponse };

export type PublicRouteParams = {
  workspaceSlug: string;
  productSlug: string;
  boardSlug: string;
};

export async function resolvePublicActor(
  request: NextRequest,
  params: PublicRouteParams,
): Promise<PublicActorResult> {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return { ok: false, response: crossOrigin };

  // The session is read before the board is resolved: a segment-gated board
  // can only answer once the visitor is known.
  const active = await findActiveCustomerSession(readCustomerSessionCookie(request));

  const tenant = await resolvePublicBoard({
    ...params,
    viewerCustomerId: active?.customer.id ?? null,
  });
  if (!tenant || !publicSurfaceEnabled(tenant.workspace.plan)) {
    return { ok: false, response: jsonError(404, "Not found.") };
  }

  if (active && active.session.workspaceId === tenant.workspace.id) {
    if (active.session.guest && !tenant.board.guestPosting) {
      return {
        ok: false,
        response: jsonError(
          401,
          "Add your email address before participating on this board.",
        ),
      };
    }

    return {
      ok: true,
      actor: {
        tenant,
        customerId: active.customer.id,
        customerName: active.customer.name,
        identified: !active.session.guest && active.customer.email !== null,
        guestCookie: null,
      },
    };
  }

  if (!tenant.board.guestPosting) {
    return {
      ok: false,
      response: jsonError(401, "This board does not accept guest participation."),
    };
  }

  const created = await createGuestCustomerSession(tenant.workspace.id);

  return {
    ok: true,
    actor: {
      tenant,
      customerId: created.active.customer.id,
      customerName: created.active.customer.name,
      identified: false,
      guestCookie: created.cookieValue,
    },
  };
}

/** Shared JSON response with no-store headers. */
export function publicJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}
