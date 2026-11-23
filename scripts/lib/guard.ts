/**
 * Safety guard for scripts that write to a database.
 *
 * These scripts are developer tools, not application code. A seed or reset run
 * against production is unrecoverable, so the default is to refuse anything
 * that is not clearly a disposable local database:
 *
 *   - `NODE_ENV=production` is refused outright (unless a script explicitly
 *     opts into a production migration path);
 *   - a non-loopback `DATABASE_URL` requires `--allow-remote`;
 *   - a destructive reset requires `--yes`.
 *
 * `--allow-remote` is deliberately not a silent flag: it appears in the
 * command line and in shell history, which is the point.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function fail(script: string, message: string): never {
  console.error(`[${script}] ${message}`);
  process.exit(1);
}

export function assertScriptEnvironment(
  script: string,
  options: {
    /** Refuse `NODE_ENV=production`. Default true. */
    refuseProduction?: boolean;
    /** Require `--yes` before doing destructive work. */
    requireYes?: boolean;
    /** Allow a non-loopback database with `--allow-remote`. Default true. */
    allowRemote?: boolean;
  } = {},
): void {
  const args = process.argv.slice(2);
  const refuseProduction = options.refuseProduction ?? true;
  const allowRemote = options.allowRemote ?? true;

  if (refuseProduction && process.env.NODE_ENV === "production") {
    fail(script, "refusing to run with NODE_ENV=production.");
  }

  if (options.requireYes && !args.includes("--yes")) {
    fail(script, "this script is destructive; re-run with --yes to confirm.");
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) fail(script, "DATABASE_URL is required.");

  let host: string;
  try {
    host = new URL(connectionString).hostname;
  } catch {
    fail(script, "DATABASE_URL is not a valid URL.");
  }

  if (!allowRemote) return;
  if (!LOOPBACK_HOSTS.has(host) && !args.includes("--allow-remote")) {
    fail(
      script,
      `database host "${host}" is not loopback; re-run with --allow-remote if this is intentional.`,
    );
  }
}
