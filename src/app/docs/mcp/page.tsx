import type { Metadata } from "next";

import { PublicDoc } from "@/features/docs/public-doc";

export const metadata: Metadata = {
  title: "MCP clients",
  description:
    "Connect Cursor, Claude Code, Claude web and Desktop, ChatGPT or VS Code to Herald's remote MCP server and work with feedback, roadmap and support from the editor.",
  alternates: { canonical: "/docs/mcp" },
};

export const dynamic = "force-static";

export default function McpClientsDocPage() {
  return (
    <PublicDoc
      file="docs/mcp-clients.md"
      eyebrow="Developer guide"
      title="MCP clients"
      intro="Herald's remote MCP server exposes the same API your token already scopes, so an editor or agent can read boards, file requests and reply without a bespoke integration."
    />
  );
}
