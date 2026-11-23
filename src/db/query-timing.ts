import type { PoolClient } from "pg";

import { recordQueryDuration } from "./slow-query-log";

/**
 * Time every statement on a pooled client.
 *
 * Wrapping `client.query` (rather than the pool) covers both plain queries and
 * statements inside a transaction, because `pg.Pool.query` checks out a client
 * and calls the same method. The wrapper preserves the promise/callback return
 * shape and never swallows an error.
 */
export function instrumentClientQueryTiming(client: PoolClient): void {
  const original = client.query.bind(client) as (...args: unknown[]) => unknown;

  client.query = ((...args: unknown[]) => {
    const first = args[0] as { text?: string } | string | undefined;
    const statement = typeof first === "string" ? first : (first?.text ?? null);
    const started = performance.now();

    let result: unknown;
    try {
      result = original(...args);
    } catch (error) {
      recordQueryDuration(statement, performance.now() - started);
      throw error;
    }

    if (result && typeof (result as { then?: unknown }).then === "function") {
      return (result as Promise<unknown>).then(
        (value) => {
          recordQueryDuration(statement, performance.now() - started);
          return value;
        },
        (error: unknown) => {
          recordQueryDuration(statement, performance.now() - started);
          throw error;
        },
      );
    }

    recordQueryDuration(statement, performance.now() - started);
    return result;
  }) as PoolClient["query"];
}
