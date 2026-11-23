import { handleApiRequest } from "@/features/api-v1/router";
import { withRouteInstrumentation } from "@/lib/observability/route";

/**
 * `/api/v1/*`.
 *
 * Every method goes through the same router so bearer authentication, rate
 * limiting, request ids, idempotency and error shapes are identical across
 * resources. Responses are never cached.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handle = (request: Request, context?: unknown) =>
  handleApiRequest(request, context as { params: Promise<{ segments?: string[] }> });

export const GET = withRouteInstrumentation("GET /api/v1/[...segments]", handle);
export const POST = withRouteInstrumentation("POST /api/v1/[...segments]", handle);
export const PATCH = withRouteInstrumentation("PATCH /api/v1/[...segments]", handle);
export const DELETE = withRouteInstrumentation("DELETE /api/v1/[...segments]", handle);
