#!/usr/bin/env bun
/**
 * Upload server source maps to a Sentry-compatible release.
 *
 * The runtime emits errors with `release` and `environment` tags. Sentry only
 * symbolises a stack when that release has an artifact bundle, so this script
 * creates the release, injects debug ids into the built server output, uploads
 * `.next/server` and finalises the release.
 *
 * Configuration (all required for an upload):
 *   SENTRY_ORG, SENTRY_PROJECT, SENTRY_AUTH_TOKEN, RELEASE_VERSION
 *
 * Uploads run through `sentry-cli` when it is installed, otherwise through the
 * newer `sentry` CLI, which exposes the same steps under different commands.
 *
 * With any value missing the script prints a skip message and exits 0, so a
 * deployment without error tracking still builds. When configured, a failure
 * exits non-zero: a release whose maps did not upload would silently produce
 * unreadable stack traces.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const required = ["SENTRY_ORG", "SENTRY_PROJECT", "SENTRY_AUTH_TOKEN", "RELEASE_VERSION"];
const missing = required.filter((name) => !process.env[name]?.trim());

if (missing.length > 0) {
  console.log(
    `source maps: skipped (missing ${missing.join(", ")}). ` +
      "Set them to upload a release, or leave them unset to keep error reporting log-only.",
  );
  process.exit(0);
}

if (!existsSync(".next/server")) {
  console.error("source maps: .next/server does not exist. Run `bun run build` first.");
  process.exit(1);
}

/** `sentry-cli` first; the newer `sentry` CLI when that binary is absent. */
const cli = ["sentry-cli", "sentry"].find(
  (bin) => spawnSync(bin, ["--version"], { stdio: "ignore" }).status === 0,
);

if (!cli) {
  console.error(
    "source maps: neither sentry-cli nor the sentry CLI is installed. Install one and rerun, " +
      "or skip this optional step.",
  );
  process.exit(1);
}

function run(args: string[]): void {
  const result = spawnSync(cli as string, args, {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(`source maps: ${cli} could not be executed.`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`source maps: ${cli} ${args.join(" ")} failed.`);
    process.exit(result.status ?? 1);
  }
}

const release = process.env.RELEASE_VERSION!.trim();
const dist = process.env.RELEASE_DIST?.trim();

console.log(`source maps: uploading server maps for ${release}`);

if (cli === "sentry-cli") {
  run(["releases", "new", release, ...(dist ? ["--dist", dist] : [])]);
  run(["sourcemaps", "inject", ".next/server"]);
  run([
    "sourcemaps",
    "upload",
    "--release",
    release,
    ...(dist ? ["--dist", dist] : []),
    "--url-prefix",
    "app:///_next/server",
    ".next/server",
  ]);
  run(["releases", "finalize", release]);
} else {
  // `sentry` takes `org/version` and injects missing debug ids during upload.
  const target = `${process.env.SENTRY_ORG!.trim()}/${release}`;
  run(["release", "create", target, "--project", process.env.SENTRY_PROJECT!.trim()]);
  run([
    "sourcemap",
    "upload",
    "--release",
    release,
    ...(dist ? ["--dist", dist] : []),
    "--url-prefix",
    "app:///_next/server",
    ".next/server",
  ]);
  run(["release", "finalize", target]);
}
console.log("source maps: done");
