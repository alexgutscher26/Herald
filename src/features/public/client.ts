/** Browser-side helper for the public write endpoints. */

export type JsonResult = {
  ok: boolean;
  status: number;
  data: Record<string, unknown>;
};

export async function sendJson(
  url: string,
  method: "POST" | "DELETE",
  body?: unknown,
): Promise<JsonResult> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? null : JSON.stringify(body),
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, data };
}

export function errorMessage(result: JsonResult, fallback: string): string {
  return typeof result.data.error === "string" ? result.data.error : fallback;
}
