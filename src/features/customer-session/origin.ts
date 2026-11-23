/**
 * Same-origin check for customer write endpoints.
 *
 * `SameSite=Lax` reduces cross-site POSTs but is not the boundary: a
 * same-site subdomain or a browser that sends no cookie still must not be
 * able to drive a write through a form. Mutations require either a matching
 * `Origin` header, or — for same-origin requests that omit it — a
 * `Sec-Fetch-Site: same-origin` hint. Anything else is rejected.
 */

export function isSameOriginRequest(input: {
  origin: string | null;
  secFetchSite: string | null;
  expectedOrigin: string;
}): boolean {
  if (input.secFetchSite === "cross-site") return false;

  if (input.origin === null || input.origin === "") {
    return input.secFetchSite === "same-origin";
  }

  try {
    return new URL(input.origin).origin === new URL(input.expectedOrigin).origin;
  } catch {
    return false;
  }
}
