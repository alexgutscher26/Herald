# MCP clients

Herald exposes a stateless remote MCP server at:

```
https://your-herald.example/api/mcp
```

It speaks Streamable HTTP and answers JSON (no SSE session is required). A
tool call goes through the same `/api/v1` router, so scopes, tenant isolation,
moderation, idempotency and rate limits are identical to REST. Clients can send
a workspace API token as a bearer header, or complete the built-in OAuth 2.1
flow. Create a token with **read** scope for analysis; add **write** only if the
client should reply, file requests or change status.

`initialize`, `ping`, `tools/list` and `tools/call` are supported. The server
negotiates `2026-07-28`, `2025-11-25`, `2025-06-18` or `2025-03-26`. The tool
catalog includes boards, requests, comments, votes, tags, changelog drafts,
members, companies and support conversations.

Verify a token before configuring a client:

```bash
curl -X POST "$BETTER_AUTH_URL/api/mcp" \
  -H "Authorization: Bearer hrl_…" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Cursor

Create or edit `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):

```json
{
  "mcpServers": {
    "herald": {
      "url": "https://your-herald.example/api/mcp",
      "headers": {
        "Authorization": "Bearer hrl_your_token"
      }
    }
  }
}
```

Reload MCP servers from Cursor settings. The token is stored in the local
config file; keep that file out of version control.

## Claude Code

Add the HTTP server with a header:

```bash
claude mcp add --transport http herald \
  https://your-herald.example/api/mcp \
  --header "Authorization: Bearer hrl_your_token"
```

Use `-s user` to make it available in every project, or `-s project` to share
the server definition (not the token) with the repository. Confirm with
`claude mcp list`, then ask Claude to call `list_boards` or `list_requests`.

For a token that is minted per session, use a `headersHelper` command that
prints `{"Authorization":"Bearer …"}` instead of storing a static value.

## Claude web and Desktop

Claude custom connectors support fixed request headers on some plans:

1. **Settings → Connectors → Add custom connector**.
2. Name it `Herald` and enter `https://your-herald.example/api/mcp`.
3. Choose **No sign-in**.
4. Under **Request headers**, add `Authorization` with the value
   `Bearer hrl_your_token`.

Request-header authentication is a beta feature for a limited set of
organizations. If the Request headers section is not available, use Claude Code
above, or run a local `mcp-remote` bridge from Claude Desktop:

```json
{
  "mcpServers": {
    "herald": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://your-herald.example/api/mcp",
        "--header",
        "Authorization: Bearer hrl_your_token"
      ]
    }
  }
}
```

The bridge holds the token locally; it does not make the endpoint public.

## ChatGPT and other OAuth clients

Herald is an OAuth 2.1 authorization server for MCP. Point the connector at
`https://your-herald.example/api/mcp` and let it discover the flow, or enter the
URLs manually:

| Metadata | URL |
| --- | --- |
| Protected resource | `https://your-herald.example/.well-known/oauth-protected-resource` |
| Authorization server | `https://your-herald.example/.well-known/oauth-authorization-server` |
| Authorization | `https://your-herald.example/oauth/authorize` |
| Token | `https://your-herald.example/oauth/token` |
| Dynamic registration | `https://your-herald.example/oauth/register` |

Flow:

1. The client registers a public client and receives a `client_id` (no secret).
2. It opens the authorization page with `response_type=code`, PKCE `S256`,
   `redirect_uri`, `state` and optionally `scope`. Register the redirect URI
   with the client first; it is matched exactly.
3. The person signs in, chooses a workspace they own or administer, and
   approves **read** and/or **write**. Herald issues a single-use code valid for
   five minutes.
4. The client exchanges the code at `/oauth/token` with its PKCE verifier. The
   response contains a 30-day access token and no refresh token. Re-run
   authorization when it expires.

The consent screen requires `settings:manage` in the chosen workspace. The
issued token appears under **Settings → API tokens** as `MCP · <client>` with an
`expires_at`; revoking it disconnects the client immediately. Access and
resource metadata are public, while every tool call still requires the token.

If a client only supports a static bearer header, use Cursor, Claude Code or VS
Code below instead. If it supports OAuth but not dynamic registration, register
the client yourself with a `POST /oauth/register` request and provide the
resulting `client_id`.

## VS Code

VS Code reads `.vscode/mcp.json` (workspace) or the user-profile `mcp.json`.
Use an input so the token is prompted instead of committed:

```json
{
  "inputs": [
    {
      "id": "herald-token",
      "type": "promptString",
      "description": "Herald API token",
      "password": true
    }
  ],
  "servers": {
    "herald": {
      "type": "http",
      "url": "https://your-herald.example/api/mcp",
      "headers": {
        "Authorization": "Bearer ${input:herald-token}"
      }
    }
  }
}
```

Open the MCP view, start `herald`, and run a tool. If the token is wrong, the
server answers `401` and the MCP call returns the same JSON error as REST.

## Operational notes

- The endpoint is stateless; restarting a client does not orphan a session.
- `GET /api/mcp` returns `405`; use `POST`.
- A `401` includes `WWW-Authenticate: Bearer resource_metadata="…"`, which is
  how OAuth-capable clients find the flow.
- A tool call consumes one rate-limit unit, not two. The allowance comes from
  the workspace plan (Free 60, Indie 120, Professional 600, Lifetime 300 per
  minute, per token).
- Write tools accept `idempotency_key`; pass it so an agent retry cannot
  duplicate a comment or reply.
- The token's workspace is the only tenant the tools can see. A guessed id from
  another workspace is a `404`.
