/**
 * Playground authorization policy.
 *
 * Kept pure so the rule is testable without a database or a live token. The
 * route still resolves the token through the normal API authenticator; this
 * module only decides whether the method is a write that needs the `write`
 * scope.
 */

export const PLAYGROUND_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
] as const;

export type PlaygroundMethod = (typeof PLAYGROUND_METHODS)[number];

export function isPlaygroundMethod(value: string): value is PlaygroundMethod {
  return (PLAYGROUND_METHODS as readonly string[]).includes(value);
}

export function playgroundNeedsWriteScope(method: string): boolean {
  return method !== "GET" && method !== "HEAD";
}

export function playgroundScopeAllows(
  scopes: readonly string[],
  method: string,
): boolean {
  return !playgroundNeedsWriteScope(method) || scopes.includes("write");
}
