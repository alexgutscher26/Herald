/**
 * Connection-string normalisation for `pg`.
 *
 * `pg-connection-string` v2 maps the `sslmode` values `prefer`, `require` and
 * `verify-ca` onto `verify-full`, and prints a process-wide deprecation
 * warning saying v3 will adopt the weaker libpq semantics instead. Left alone,
 * every server render that opens the pool prints that warning.
 *
 * Rewriting the alias to the mode it already selects keeps today's certificate
 * verification, removes the noise, and stays correct after the driver upgrade.
 * A caller that explicitly opted into libpq semantics with
 * `uselibpqcompat=true` keeps its value, because that is the documented escape
 * hatch for the upcoming behaviour.
 */

const LEGACY_SSL_MODE = /(^|&)sslmode=(prefer|require|verify-ca)(?=&|$)/i;
const LIBPQ_COMPAT = /(^|&)uselibpqcompat=(true|1)(?=&|$)/i;
const VERIFY_FULL = "verify-full";

/**
 * Replace a legacy `sslmode` alias with `verify-full`.
 *
 * Only the query is inspected and rewritten, so the credential, host and path
 * of the URL are returned exactly as supplied — even when the password itself
 * contains the text `sslmode=`.
 */
export function normalizeSslMode(connectionString: string): string {
  const queryStart = connectionString.indexOf("?");
  if (queryStart === -1) return connectionString;

  const query = connectionString.slice(queryStart + 1);
  if (LIBPQ_COMPAT.test(query)) return connectionString;

  const rewritten = query.replace(LEGACY_SSL_MODE, `$1sslmode=${VERIFY_FULL}`);
  if (rewritten === query) return connectionString;

  return `${connectionString.slice(0, queryStart + 1)}${rewritten}`;
}
