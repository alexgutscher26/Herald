/**
 * Send one synthetic alert to the configured on-call channel.
 *
 * Usage: `bun run alerts:test`
 *
 * This proves the endpoint accepts a payload shaped like a real alert. It does
 * not prove the scheduled evaluator has run or that a provider-side monitor is
 * configured. The URL is never printed because webhook URLs often carry a
 * secret in the path.
 */

import { getAlertWebhookUrl } from "@/lib/env";
import { getReleaseInfo } from "@/lib/observability/release";

const TIMEOUT_MS = 5_000;

let url: string | null;
try {
  url = getAlertWebhookUrl();
} catch (error) {
  console.error(
    "Alert channel is misconfigured:",
    error instanceof Error ? error.message : "unknown error",
  );
  process.exit(1);
}

if (!url) {
  console.error(
    "Neither ALERT_WEBHOOK_URL nor ERROR_WEBHOOK_URL is set. Configure one in the deployment environment, then run this command again.",
  );
  process.exit(1);
}

const release = getReleaseInfo();
const payload = {
  source: "herald",
  kind: "alert_test",
  rule: "channel_test",
  title: "Herald alert channel test",
  state: "test",
  value: 1,
  threshold: 0,
  unit: "count",
  detail:
    "Synthetic launch-checklist test. It contains no tenant data and does not represent a production incident.",
  release: release.release,
  environment: release.environment,
  timestamp: new Date().toISOString(),
};

try {
  const response = await fetch(url, {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    console.error(
      `Alert channel rejected the synthetic alert: HTTP ${response.status}. Fix the endpoint before launch.`,
    );
    process.exit(1);
  }

  console.log(
    `Alert channel accepted one synthetic alert (HTTP ${response.status}) for ${release.environment}/${release.release}.`,
  );
  console.log(
    "Delivery to the endpoint is proven. The scheduled evaluate_alerts job and provider uptime monitors still need their own check.",
  );
} catch (error) {
  console.error(
    "Alert channel delivery failed:",
    error instanceof Error ? error.message : "unknown error",
  );
  process.exit(1);
}
