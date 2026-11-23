import { afterAll, beforeAll, describe, expect } from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import {
  conversationMessages,
  conversations,
  feedbackPosts,
  slackConversationLinks,
  slackIntegrations,
  slackRequestLinks,
} from "@/db/schema";
import { GET as slackCallback } from "@/app/api/integrations/slack/callback/route";
import { POST as slackEvents } from "@/app/api/integrations/slack/events/route";
import { bulkUpdateFeedbackStatuses } from "@/features/feedback/triage";
import { runDueJobs } from "@/features/jobs/queue";
import {
  consumeSlackInstallState,
  createSlackInstallState,
  getSlackIntegration,
  saveSlackChannel,
  upsertSlackIntegration,
} from "@/features/slack/service";
import { signSlackRequest } from "@/features/slack/sign";
import { uniqueLabel } from "./factories";
import { createBoard, createMember, createProduct, createWorkspace } from "./factories";
import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";

/**
 * Slack end to end against a local Slack-compatible HTTP server.
 *
 * The test proves the same pieces production uses: signature verification over
 * the raw body, OAuth code exchange, channel selection, job dispatch, the real
 * Postgres writes, and a status reply in the original thread.
 */

const SIGNING_SECRET = "slack-signing-secret-for-integration";
const TEAM_ID = "T_TEST_TEAM";
const CHANNEL_ID = "C_TEST_CHANNEL";

type SlackPost = {
  channel: string;
  text: string;
  thread_ts?: string;
};

let server: ReturnType<typeof Bun.serve> | null = null;
let slackPosts: SlackPost[] = [];
let aiSuggestion: { title: string; board_id: string } | null = null;
const aiCalls: unknown[] = [];

const previousEnv: Record<string, string | undefined> = {};

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/api/oauth.v2.access") {
        return json({
          ok: true,
          access_token: "xoxb-local-test-token",
          bot_user_id: "U_BOT",
          scope: "channels:history,chat:write",
          team: { id: TEAM_ID, name: "Herald Test Team" },
        });
      }
      if (url.pathname === "/api/chat.postMessage") {
        const body = (await request.json()) as SlackPost;
        slackPosts.push(body);
        return json({ ok: true, ts: `ts-${slackPosts.length}` });
      }
      if (url.pathname === "/api/users.info") {
        return json({
          ok: true,
          user: { profile: { display_name: "Ada", real_name: "Ada Lovelace" } },
        });
      }
      if (url.pathname === "/api/conversations.list") {
        return json({
          ok: true,
          channels: [{ id: CHANNEL_ID, name: "feedback" }],
          response_metadata: { next_cursor: "" },
        });
      }
      if (url.pathname === "/api/conversations.info") {
        return json({
          ok: true,
          channel: { id: CHANNEL_ID, name: "feedback", is_private: false },
        });
      }
      if (url.pathname === "/ai/chat/completions") {
        aiCalls.push(await request.json());
        return json({
          choices: [
            {
              message: {
                content: JSON.stringify(aiSuggestion ?? {}),
              },
            },
          ],
        });
      }
      return json({ ok: false, error: "unknown_path" }, 404);
    },
  });

  const keys = [
    "DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
    "SLACK_CLIENT_ID",
    "SLACK_CLIENT_SECRET",
    "SLACK_SIGNING_SECRET",
    "SLACK_API_URL",
    "SLACK_AUTHORIZE_URL",
    "AI_API_URL",
    "AI_MODEL",
    "AI_API_KEY",
  ];
  for (const key of keys) previousEnv[key] = process.env[key];

  process.env.DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
  process.env.BETTER_AUTH_SECRET = "slack-test-secret-at-least-32-characters";
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.SLACK_CLIENT_ID = "client-id";
  process.env.SLACK_CLIENT_SECRET = "client-secret";
  process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
  process.env.SLACK_API_URL = `http://127.0.0.1:${server.port}/api`;
  process.env.SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
  delete process.env.AI_API_URL;
  delete process.env.AI_MODEL;
  delete process.env.AI_API_KEY;

  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await teardownTestDatabase();
  server?.stop();
  server = null;
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}, SETUP_TIMEOUT_MS);

async function setupSlackProduct() {
  const workspace = await createWorkspace();
  const { user } = await createMember(workspace.id, { role: "owner" });
  const product = await createProduct(workspace.id);
  const feature = await createBoard(product.id, { name: "Feature requests", position: 0 });
  const bug = await createBoard(product.id, { name: "Bugs", position: 1 });
  const integration = await upsertSlackIntegration({
    workspaceId: workspace.id,
    productId: product.id,
    userId: user.id,
    teamId: TEAM_ID,
    teamName: "Herald Test Team",
    botUserId: "U_BOT",
    accessToken: "xoxb-local-test-token",
    scopes: "channels:history,chat:write",
  });
  if (!integration.ok) throw new Error(integration.error);
  const saved = await saveSlackChannel({
    productId: product.id,
    channelId: CHANNEL_ID,
    channelName: "feedback",
  });
  if (!saved.ok) throw new Error(saved.error);

  return { workspace, user, product, bug, feature };
}

function eventBody(input: { eventId: string; text: string; ts?: string }): string {
  return JSON.stringify({
    type: "event_callback",
    team_id: TEAM_ID,
    event_id: input.eventId,
    event: {
      type: "message",
      channel: CHANNEL_ID,
      text: input.text,
      ts: input.ts ?? "1700000000.000100",
      user: "U_AUTHOR",
    },
  });
}

async function postEvent(body: string, signingSecret = SIGNING_SECRET): Promise<Response> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return slackEvents(
    new Request("http://localhost/api/integrations/slack/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": signSlackRequest(signingSecret, timestamp, body),
      },
      body,
    }),
  );
}

async function requestRows(productId: string) {
  return db.select().from(feedbackPosts).where(eq(feedbackPosts.productId, productId));
}

describe("Slack integration", () => {
  isolatedTest("verifies the challenge and rejects an invalid signature", async () => {
    const challenge = JSON.stringify({ type: "url_verification", challenge: "abc123" });
    const response = await postEvent(challenge);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ challenge: "abc123" });

    const body = eventBody({ eventId: "Ev_bad", text: "Nope" });
    const rejected = await postEvent(body, "wrong-signing-secret");
    expect(rejected.status).toBe(401);
  });

  isolatedTest("files a message once and replies in the original thread", async () => {
    const setup = await setupSlackProduct();
    slackPosts = [];
    aiSuggestion = null;

    const body = eventBody({
      eventId: "Ev_once",
      text: "Please add CSV export to the reports page.\nFinance needs it monthly.",
    });
    expect((await postEvent(body)).status).toBe(200);
    // Slack retries the same event after a timeout; the dedupe key means one job.
    expect((await postEvent(body)).status).toBe(200);

    const summary = await runDueJobs(20);
    expect(summary.failed).toBe(0);

    const requests = await requestRows(setup.product.id);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      source: "slack",
      authorLabel: "Ada",
      boardId: setup.feature.id,
      title: "Please add CSV export to the reports page.",
      status: "open",
    });

    const links = await db
      .select()
      .from(slackRequestLinks)
      .where(eq(slackRequestLinks.requestId, requests[0]!.id));
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      teamId: TEAM_ID,
      channelId: CHANNEL_ID,
      messageTs: "1700000000.000100",
    });

    expect(slackPosts).toHaveLength(1);
    expect(slackPosts[0]).toMatchObject({
      channel: CHANNEL_ID,
      thread_ts: "1700000000.000100",
    });
    expect(slackPosts[0]?.text).toContain("was created on *Feature requests*");
  });

  isolatedTest("uses the AI suggestion when a provider is configured", async () => {
    const setup = await setupSlackProduct();
    slackPosts = [];
    aiSuggestion = { title: "CSV export for finance", board_id: setup.bug.id };
    aiCalls.length = 0;
    process.env.AI_API_URL = `http://127.0.0.1:${server?.port}/ai`;
    process.env.AI_MODEL = "test-model";

    try {
      const response = await postEvent(
        eventBody({
          eventId: "Ev_ai",
          text: "The CSV button crashes every time; this looks like a bug.",
          ts: "1700000000.000200",
        }),
      );
      expect(response.status).toBe(200);
      await runDueJobs(20);

      const requests = await requestRows(setup.product.id);
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        boardId: setup.bug.id,
        title: "CSV export for finance",
        source: "slack",
      });
      expect(aiCalls).toHaveLength(1);
    } finally {
      delete process.env.AI_API_URL;
      delete process.env.AI_MODEL;
    }
  });

  isolatedTest("posts a thread reply when a Slack request changes status", async () => {
    const setup = await setupSlackProduct();
    slackPosts = [];

    await postEvent(
      eventBody({
        eventId: "Ev_status",
        text: "Please add a dark mode.",
        ts: "1700000000.000300",
      }),
    );
    await runDueJobs(20);
    const [request] = await requestRows(setup.product.id);
    if (!request) throw new Error("Slack request was not created.");

    slackPosts = [];
    const updated = await bulkUpdateFeedbackStatuses({
      productId: setup.product.id,
      postIds: [request.id],
      status: "planned",
    });
    expect(updated.updated).toBe(1);

    const summary = await runDueJobs(20);
    expect(summary.failed).toBe(0);
    expect(slackPosts).toHaveLength(1);
    expect(slackPosts[0]).toMatchObject({
      channel: CHANNEL_ID,
      thread_ts: "1700000000.000300",
    });
    expect(slackPosts[0]?.text).toContain("is now *Planned*");

    // The same transition queued twice does not send a second thread message.
    slackPosts = [];
    await bulkUpdateFeedbackStatuses({
      productId: setup.product.id,
      postIds: [request.id],
      status: "planned",
    });
    await runDueJobs(20);
    expect(slackPosts).toHaveLength(0);
  });

  isolatedTest("exchanges OAuth once and saves the installation without a channel", async () => {
    const workspace = await createWorkspace();
    const { user } = await createMember(workspace.id, { role: "owner" });
    const product = await createProduct(workspace.id);
    const state = await createSlackInstallState({
      workspaceId: workspace.id,
      productId: product.id,
      userId: user.id,
    });

    const response = await slackCallback(
      new Request(
        `http://localhost/api/integrations/slack/callback?code=local-code&state=${encodeURIComponent(state)}`,
      ),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("slack=connected");

    const integration = await getSlackIntegration(product.id);
    expect(integration).toMatchObject({
      teamId: TEAM_ID,
      teamName: "Herald Test Team",
      channelId: null,
      active: true,
    });

    const [row] = await db
      .select({ id: slackIntegrations.id })
      .from(slackIntegrations)
      .where(eq(slackIntegrations.productId, product.id));
    expect(row).toBeTruthy();

    // A replayed callback cannot consume the same state again.
    expect(await consumeSlackInstallState(state)).toBeNull();
    const replay = await slackCallback(
      new Request(
        `http://localhost/api/integrations/slack/callback?code=local-code&state=${encodeURIComponent(state)}`,
      ),
    );
    expect(replay.headers.get("location")).toContain("slack=invalid_state");
  });

  isolatedTest("isolates events by connected channel", async () => {
    const setup = await setupSlackProduct();
    const body = JSON.stringify({
      type: "event_callback",
      team_id: TEAM_ID,
      event_id: `Ev_${uniqueLabel("other")}`,
      event: {
        type: "message",
        channel: "C_NOT_CONNECTED",
        text: "Should be ignored",
        ts: "1700000000.000400",
        user: "U_AUTHOR",
      },
    });
    const response = await postEvent(body);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ignored: "channel_not_connected" });

    await runDueJobs(20);
    expect(await requestRows(setup.product.id)).toHaveLength(0);
  });

  isolatedTest("starts and continues a support thread through the signed route", async () => {
    const setup = await setupSlackProduct();
    slackPosts = [];

    const startBody = JSON.stringify({
      type: "event_callback",
      team_id: TEAM_ID,
      event_id: "Ev_support_start",
      event: {
        type: "message",
        channel: CHANNEL_ID,
        text: "!support My export fails every morning",
        ts: "1700000000.000500",
        user: "U_AUTHOR",
      },
    });
    expect((await postEvent(startBody)).status).toBe(200);
    expect((await postEvent(startBody)).status).toBe(200);
    const started = await runDueJobs(20);
    expect(started.failed).toBe(0);

    const conversationRows = await db
      .select()
      .from(conversations)
      .where(eq(conversations.productId, setup.product.id));
    expect(conversationRows).toHaveLength(1);
    expect(conversationRows[0]).toMatchObject({
      status: "queue",
      subject: "My export fails every morning",
      sourceContext: { channel: "slack" },
    });

    const messageRows = await db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversationRows[0]!.id));
    expect(messageRows).toHaveLength(1);
    expect(messageRows[0]).toMatchObject({
      channel: "slack",
      authorType: "customer",
      body: "My export fails every morning",
    });

    const links = await db
      .select()
      .from(slackConversationLinks)
      .where(eq(slackConversationLinks.conversationId, conversationRows[0]!.id));
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      teamId: TEAM_ID,
      channelId: CHANNEL_ID,
      threadTs: "1700000000.000500",
    });

    // A reply in the mapped thread continues the same conversation.
    const replyBody = JSON.stringify({
      type: "event_callback",
      team_id: TEAM_ID,
      event_id: "Ev_support_reply",
      event: {
        type: "message",
        channel: CHANNEL_ID,
        text: "It happens on the finance report.",
        ts: "1700000000.000501",
        thread_ts: "1700000000.000500",
        user: "U_AUTHOR",
      },
    });
    expect((await postEvent(replyBody)).status).toBe(200);
    const continued = await runDueJobs(20);
    expect(continued.failed).toBe(0);

    const afterReply = await db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversationRows[0]!.id));
    expect(afterReply).toHaveLength(2);
    expect(afterReply[1]).toMatchObject({
      body: "It happens on the finance report.",
      channel: "slack",
    });

    const [updated] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationRows[0]!.id));
    expect(updated?.unreadForTeam).toBe(2);

    // A Slack retry of the same reply id is inert.
    expect((await postEvent(replyBody)).status).toBe(200);
    await runDueJobs(20);
    const afterRetry = await db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversationRows[0]!.id));
    expect(afterRetry).toHaveLength(2);

    // A support thread never becomes a feedback request.
    expect(await requestRows(setup.product.id)).toHaveLength(0);
  });
});
