import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Slack's Events API signs `v0:<timestamp>:<raw body>`. */
export const SLACK_SIGNATURE_VERSION = "v0";
export const SLACK_TIMESTAMP_TOLERANCE_SECONDS = 300;

export function signSlackRequest(
  signingSecret: string,
  timestamp: string,
  body: string,
): string {
  const digest = createHmac("sha256", signingSecret)
    .update(`${SLACK_SIGNATURE_VERSION}:${timestamp}:${body}`)
    .digest("hex");
  return `${SLACK_SIGNATURE_VERSION}=${digest}`;
}

export function verifySlackSignature(input: {
  signingSecret: string;
  timestamp: string | null;
  body: string;
  signature: string | null;
  now?: number;
  toleranceSeconds?: number;
}): boolean {
  if (!input.timestamp || !input.signature) return false;
  if (!/^\d{1,12}$/.test(input.timestamp)) return false;

  const timestamp = Number.parseInt(input.timestamp, 10);
  if (!Number.isSafeInteger(timestamp)) return false;

  const tolerance = input.toleranceSeconds ?? SLACK_TIMESTAMP_TOLERANCE_SECONDS;
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - timestamp) > tolerance) return false;

  const expected = signSlackRequest(input.signingSecret, input.timestamp, input.body);
  const provided = Buffer.from(input.signature, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  if (provided.length !== wanted.length) return false;
  return timingSafeEqual(provided, wanted);
}

/** OAuth state is high-entropy and stored only as a SHA-256 hash. */
export function createSlackState(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSlackState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}
