import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { workspaces } from "@/db/schema";
import {
  frameAncestorsForEmbed,
  NOT_FRAMEABLE,
} from "@/features/security/policy";
import { readWidgetAccessSettings } from "./settings";

/**
 * Resolve `frame-ancestors` for an embed request.
 *
 * The embed gate in the page already refuses a request whose `host` is not on
 * the workspace's allowlist, but that check runs after the document is
 * delivered, so the browser still renders a framed 404. The header is the
 * enforcement point: it names the same origins the gate accepts, and the proxy
 * applies it before any HTML is produced.
 *
 * An unknown workspace is not frameable at all. A workspace without settings,
 * or with an empty allowlist, is open to any origin — the embed gate's own
 * definition of "unconfigured".
 */
export async function embedFrameAncestors(pathname: string): Promise<string> {
  const workspaceSlug = pathname.split("/").filter(Boolean)[1];
  if (!workspaceSlug) return NOT_FRAMEABLE;

  const rows = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.slug, workspaceSlug))
    .limit(1);
  const workspace = rows[0];
  if (!workspace) return NOT_FRAMEABLE;

  const settings = await readWidgetAccessSettings(workspace.id);
  return frameAncestorsForEmbed(settings?.allowedOrigins ?? null);
}
