import {
  createHmac,
  sign as signWithKey,
  timingSafeEqual,
} from "node:crypto";

import { z } from "zod";

import { getServerEnv } from "@/lib/env";

/**
 * GitHub App authentication primitives.
 *
 * The App private key never leaves the server. Installation tokens are minted
 * from a short-lived App JWT on demand, so the previous personal-access-token
 * import path can work with private repositories without storing a user token.
 */

const githubAppSchema = z.object({
  GITHUB_APP_ID: z.string().regex(/^\d{1,20}$/, "GITHUB_APP_ID must be numeric"),
  GITHUB_APP_SLUG: z
    .string()
    .regex(/^[a-z0-9-]{1,100}$/, "GITHUB_APP_SLUG must be the app's URL slug"),
  GITHUB_APP_PRIVATE_KEY: z
    .string()
    .includes("BEGIN", { message: "GITHUB_APP_PRIVATE_KEY must be a PEM private key" }),
});

export type GithubAppConfig = z.infer<typeof githubAppSchema>;

function normalizePrivateKey(raw: string): string {
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

export function getGithubAppConfig(): GithubAppConfig | null {
  const appId = process.env.GITHUB_APP_ID?.trim() ?? "";
  const slug = process.env.GITHUB_APP_SLUG?.trim().toLowerCase() ?? "";
  const privateKey = normalizePrivateKey(process.env.GITHUB_APP_PRIVATE_KEY?.trim() ?? "");
  if (appId === "" && slug === "" && privateKey === "") return null;

  const parsed = githubAppSchema.safeParse({
    GITHUB_APP_ID: appId,
    GITHUB_APP_SLUG: slug,
    GITHUB_APP_PRIVATE_KEY: privateKey,
  });
  if (!parsed.success) {
    throw new Error(
      `Invalid GitHub App configuration — ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}.`,
    );
  }
  return parsed.data;
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

/**
 * A GitHub App JWT: RS256 over the standard header/payload. GitHub allows a
 * maximum ten-minute lifetime; this uses nine minutes with one minute of clock
 * skew.
 */
export function createGithubAppJwt(input: {
  appId: string;
  privateKey: string;
  now?: number;
}): string {
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iat: nowSeconds - 60,
      exp: nowSeconds + 9 * 60,
      iss: input.appId,
    }),
  );
  const unsigned = `${header}.${payload}`;
  const signature = signWithKey("RSA-SHA256", Buffer.from(unsigned), input.privateKey);
  return `${unsigned}.${base64url(signature)}`;
}

export type GithubInstallState = {
  workspaceId: string;
  productId: string;
  userId: string;
  workspaceSlug: string;
  productSlug: string;
  expiresAt: number;
};

export function createGithubInstallState(
  input: Omit<GithubInstallState, "expiresAt">,
  options: { secret: string; now?: number; ttlMs?: number },
): string {
  const payload: GithubInstallState = {
    ...input,
    expiresAt: (options.now ?? Date.now()) + (options.ttlMs ?? 10 * 60 * 1000),
  };
  const encoded = base64url(JSON.stringify(payload));
  const signature = createHmac("sha256", options.secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyGithubInstallState(
  token: string,
  options: { secret: string; now?: number },
): GithubInstallState | null {
  const [encoded, signature] = token.split(".", 2);
  if (!encoded || !signature) return null;
  const expected = createHmac("sha256", options.secret).update(encoded).digest("base64url");
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;
  const candidate = payload as Partial<GithubInstallState>;
  if (
    typeof candidate.workspaceId !== "string" ||
    typeof candidate.productId !== "string" ||
    typeof candidate.userId !== "string" ||
    typeof candidate.workspaceSlug !== "string" ||
    typeof candidate.productSlug !== "string" ||
    typeof candidate.expiresAt !== "number" ||
    !Number.isSafeInteger(candidate.expiresAt)
  ) {
    return null;
  }
  if (candidate.expiresAt <= (options.now ?? Date.now())) return null;
  return candidate as GithubInstallState;
}

export function githubInstallUrl(config: GithubAppConfig, state: string): string {
  return `https://github.com/apps/${encodeURIComponent(
    config.GITHUB_APP_SLUG,
  )}/installations/new?state=${encodeURIComponent(state)}`;
}

/** The callback is a deployment origin, never a client-supplied Host. */
export function githubCallbackUrl(): string {
  return `${getServerEnv().BETTER_AUTH_URL.replace(/\/+$/, "")}/api/integrations/github/callback`;
}
