import { NextResponse } from "next/server";

import { reportError } from "@/lib/error-report";
import { isUuid } from "./cursor";
import {
  authenticateApiRequest,
  requireReadScope,
  requireScope,
  type ApiAuth,
} from "./auth";
import {
  handleBoard,
  handleBoards,
  handleChangelog,
  handleChangelogs,
  handleComments,
  handleCompanies,
  handleCompany,
  handleCompanyCustomers,
  handleConversation,
  handleConversations,
  handleCustomField,
  handleCustomFields,
  handleEvents,
  handleMembers,
  handleMessages,
  handleNotes,
  handleRequest,
  handleRequestBrief,
  handleRequests,
  handleRoot,
  handleTag,
  handleTags,
  handleVotes,
} from "./handlers";
import { ApiFailure, apiErrorResponse, apiNotFound, apiRequestId } from "./http";
import { withIdempotency } from "./idempotency";
import { apiPathIsDeclared, readResourceForSegments } from "./routes";

/**
 * `/api/v1` router.
 *
 * A single catch-all route keeps authentication, rate limiting, request ids,
 * idempotency and error translation in one place; every endpoint inherits the
 * same behavior instead of re-implementing it.
 *
 * Path ids must be UUIDs. Anything else is answered exactly like a missing
 * row, so probing cannot distinguish "malformed" from "exists elsewhere".
 */

type RouteContext = { params: Promise<{ segments?: string[] }> };

function idOr404(auth: ApiAuth, value: string): string {
  if (!isUuid(value)) throw apiNotFound(auth.requestId, "Resource");
  return value;
}

function idempotencyKey(request: Request): string | null {
  return request.headers.get("idempotency-key");
}

async function route(
  request: Request,
  auth: ApiAuth,
  segments: string[],
): Promise<NextResponse> {
  const method = request.method.toUpperCase();

  // The manifest is the public contract: a route that is not declared there is
  // not reachable, even if a handler was added to the switch below.
  if (!apiPathIsDeclared(segments)) {
    throw apiNotFound(auth.requestId, "Endpoint");
  }

  // Narrow resource reads before dispatch. Handlers still assert "can it read
  // at all?"; this gate decides *what* a resource-specific scope unlocks. The
  // root endpoint stays available to any valid token because it only describes
  // the workspace, matching the pre-scope behaviour.
  if (method === "GET" && segments.length > 0) {
    requireReadScope(auth, readResourceForSegments(segments));
  }

  if (segments.length === 0) {
    if (method !== "GET") {
      throw new ApiFailure(405, "invalid_request", "Method not allowed.", {
        headers: { allow: "GET" },
      });
    }
    return handleRoot(auth);
  }

  const [resource, first, second, ...rest] = segments;

  if (rest.length > 0) throw apiNotFound(auth.requestId, "Endpoint");

  switch (resource) {
    case "boards":
      if (!first) return handleBoards(auth, request, method);
      if (!second) return handleBoard(auth, request, method, idOr404(auth, first));
      throw apiNotFound(auth.requestId, "Endpoint");

    case "events": {
      if (first) throw apiNotFound(auth.requestId, "Endpoint");
      if (method !== "POST") return handleEvents(auth, request, method);
      requireScope(auth, "write");
      return withIdempotency({
        request,
        auth,
        endpoint: "POST /api/v1/events",
        key: idempotencyKey(request),
        handler: async (bodyText) => {
          const replayable = new Request(request.url, {
            method: "POST",
            headers: request.headers,
            body: bodyText,
          });
          return handleEvents(auth, replayable, method);
        },
      });
    }

    case "tags":
      if (!first) return handleTags(auth, request, method);
      if (!second) return handleTag(auth, method, idOr404(auth, first));
      throw apiNotFound(auth.requestId, "Endpoint");

    case "custom-fields":
      if (!first) return handleCustomFields(auth, request, method);
      if (!second) {
        return handleCustomField(auth, request, method, idOr404(auth, first));
      }
      throw apiNotFound(auth.requestId, "Endpoint");

    case "requests": {
      if (!first) {
        if (method === "POST") {
          requireScope(auth, "write");
          return withIdempotency({
            request,
            auth,
            endpoint: "POST /api/v1/requests",
            key: idempotencyKey(request),
            handler: async (bodyText) => {
              const replayable = new Request(request.url, {
                method: "POST",
                headers: request.headers,
                body: bodyText,
              });
              return handleRequests(auth, replayable, method);
            },
          });
        }
        return handleRequests(auth, request, method);
      }

      const requestId = idOr404(auth, first);
      if (!second) return handleRequest(auth, request, method, requestId);
      if (second === "brief") return handleRequestBrief(auth, method, requestId);
      if (second === "comments") {
        if (method === "POST") {
          requireScope(auth, "write");
          const endpoint = `POST /api/v1/requests/:id/comments`;
          return withIdempotency({
            request,
            auth,
            endpoint,
            key: idempotencyKey(request),
            handler: async (bodyText) => {
              // The shared handler reads the body itself; hand it a fresh
              // Request so validation sees exactly the bytes we hashed.
              const replayable = new Request(request.url, {
                method: "POST",
                headers: request.headers,
                body: bodyText,
              });
              return handleComments(auth, replayable, method, requestId);
            },
          });
        }
        return handleComments(auth, request, method, requestId);
      }
      if (second === "votes") return handleVotes(auth, request, method, requestId);
      throw apiNotFound(auth.requestId, "Endpoint");
    }

    case "changelogs": {
      if (!first) {
        if (method === "POST") {
          requireScope(auth, "write");
          return withIdempotency({
            request,
            auth,
            endpoint: "POST /api/v1/changelogs",
            key: idempotencyKey(request),
            handler: async (bodyText) => {
              const replayable = new Request(request.url, {
                method: "POST",
                headers: request.headers,
                body: bodyText,
              });
              return handleChangelogs(auth, replayable, method);
            },
          });
        }
        return handleChangelogs(auth, request, method);
      }
      if (!second) return handleChangelog(auth, request, method, idOr404(auth, first));
      throw apiNotFound(auth.requestId, "Endpoint");
    }

    case "members":
      if (first) throw apiNotFound(auth.requestId, "Endpoint");
      return handleMembers(auth, method);

    case "companies":
      if (!first) return handleCompanies(auth, request, method);
      if (!second) return handleCompany(auth, request, method, idOr404(auth, first));
      if (second === "customers") {
        return handleCompanyCustomers(auth, request, method, idOr404(auth, first));
      }
      throw apiNotFound(auth.requestId, "Endpoint");

    case "conversations": {
      if (!first) return handleConversations(auth, request, method);
      const conversationId = idOr404(auth, first);
      if (!second) return handleConversation(auth, request, method, conversationId);
      if (second === "messages") {
        if (method === "POST") {
          requireScope(auth, "write");
          return withIdempotency({
            request,
            auth,
            endpoint: "POST /api/v1/conversations/:id/messages",
            key: idempotencyKey(request),
            handler: async (bodyText) => {
              const replayable = new Request(request.url, {
                method: "POST",
                headers: request.headers,
                body: bodyText,
              });
              return handleMessages(auth, replayable, method, conversationId);
            },
          });
        }
        return handleMessages(auth, request, method, conversationId);
      }
      if (second === "notes") {
        if (method === "POST") {
          requireScope(auth, "write");
          return withIdempotency({
            request,
            auth,
            endpoint: "POST /api/v1/conversations/:id/notes",
            key: idempotencyKey(request),
            handler: async (bodyText) => {
              const replayable = new Request(request.url, {
                method: "POST",
                headers: request.headers,
                body: bodyText,
              });
              return handleNotes(auth, replayable, method, conversationId);
            },
          });
        }
        return handleNotes(auth, request, method, conversationId);
      }
      throw apiNotFound(auth.requestId, "Endpoint");
    }

    default:
      throw apiNotFound(auth.requestId, "Endpoint");
  }
}

async function translateFailure(
  error: unknown,
  requestId: string,
  request: Request,
): Promise<NextResponse> {
  if (error instanceof ApiFailure) {
    return apiErrorResponse({
      status: error.status,
      code: error.code,
      message: error.message,
      requestId,
      details: error.details,
      headers: error.headers,
    });
  }

  await reportError(
    error,
    { requestId, route: `API ${request.method} ${new URL(request.url).pathname}` },
    "api.v1_unhandled",
  );
  return apiErrorResponse({
    status: 500,
    code: "internal_error",
    message: "Something went wrong. Use the request id when contacting support.",
    requestId,
  });
}

/**
 * Dispatch with an already-authenticated token.
 *
 * MCP calls use this so one agent request consumes one rate-limit token instead
 * of re-authenticating through HTTP for every tool call. Authorization, scopes,
 * validation and idempotency are still the v1 router's own.
 */
export async function runApiRequest(
  request: Request,
  segments: string[],
  auth: ApiAuth,
): Promise<NextResponse> {
  const requestId = apiRequestId(request);
  auth.requestId = requestId;

  try {
    return await route(request, auth, segments);
  } catch (error) {
    return translateFailure(error, requestId, request);
  }
}

export async function handleApiRequest(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const requestId = apiRequestId(request);

  try {
    const { segments = [] } = await context.params;
    const auth = await authenticateApiRequest(request);
    auth.requestId = requestId;
    return await route(request, auth, segments);
  } catch (error) {
    return translateFailure(error, requestId, request);
  }
}
