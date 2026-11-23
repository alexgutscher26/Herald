import { generateKeyPairSync, verify } from "node:crypto";

import { describe, expect, test } from "bun:test";

import {
  createGithubAppJwt,
  createGithubInstallState,
  githubInstallUrl,
  verifyGithubInstallState,
} from "@/features/github/app";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

function decode(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

describe("GitHub App authentication", () => {
  test("signs a short-lived RS256 app JWT", () => {
    const now = 1_700_000_000_000;
    const jwt = createGithubAppJwt({
      appId: "12345",
      privateKey,
      now,
    });
    const [header, payload, signature] = jwt.split(".");
    expect(header && payload && signature).toBeTruthy();
    expect(decode(header!)).toMatchObject({ alg: "RS256", typ: "JWT" });
    expect(decode(payload!)).toMatchObject({ iss: "12345" });
    expect(Number(decode(payload!).exp) - Number(decode(payload!).iat)).toBe(600);
    expect(
      verify(
        "RSA-SHA256",
        Buffer.from(`${header}.${payload}`),
        publicKey,
        Buffer.from(signature!, "base64url"),
      ),
    ).toBe(true);
  });

  test("binds install state to workspace, product and user", () => {
    const secret = "test-better-auth-secret-0123456789";
    const now = 1_700_000_000_000;
    const token = createGithubInstallState(
      {
        workspaceId: "workspace-1",
        productId: "product-1",
        userId: "user-1",
        workspaceSlug: "acme",
        productSlug: "roadmap",
      },
      { secret, now },
    );

    expect(verifyGithubInstallState(token, { secret, now })).toMatchObject({
      workspaceId: "workspace-1",
      productId: "product-1",
      userId: "user-1",
      workspaceSlug: "acme",
      productSlug: "roadmap",
    });
    expect(verifyGithubInstallState(`${token}x`, { secret, now })).toBeNull();
    expect(verifyGithubInstallState(token, { secret: `${secret}x`, now })).toBeNull();
    expect(
      verifyGithubInstallState(token, { secret, now: now + 11 * 60 * 1000 }),
    ).toBeNull();
  });

  test("builds the app installation URL with the signed state", () => {
    expect(
      githubInstallUrl(
        {
          GITHUB_APP_ID: "12345",
          GITHUB_APP_SLUG: "herald-feedback",
          GITHUB_APP_PRIVATE_KEY: privateKey,
        },
        "state-token",
      ),
    ).toBe(
      "https://github.com/apps/herald-feedback/installations/new?state=state-token",
    );
  });
});
