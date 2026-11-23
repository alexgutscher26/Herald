/**
 * Next CLI wrapper for the e2e suite.
 *
 * `NEXT_DIST_DIR` is set in one place so `next build` and `next start` agree,
 * and the e2e output never collides with a developer's `next dev` (which
 * rewrites `.next` continuously).
 *
 *   bun scripts/e2e/next.ts build
 *   bun scripts/e2e/next.ts start
 */
export {};

const mode = process.argv[2];
if (mode !== "build" && mode !== "start") {
  console.error("Usage: bun scripts/e2e/next.ts <build|start>");
  process.exit(1);
}

process.env.NEXT_DIST_DIR ??= ".next-e2e";
process.env.NEXT_TELEMETRY_DISABLED ??= "1";

const args =
  mode === "build"
    ? ["build"]
    : ["start", "-p", process.env.E2E_PORT ?? "3100", "-H", "127.0.0.1"];

const child = Bun.spawn(["bun", "--bun", "node_modules/next/dist/bin/next", ...args], {
  env: process.env,
  stdio: ["inherit", "inherit", "inherit"],
});

process.exit(await child.exited);
