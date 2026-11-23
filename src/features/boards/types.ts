import type { Board, BoardSettings } from "@/db/schema/boards";

/**
 * A board as the dashboard edits it.
 *
 * `settings` stays grouped exactly as it is stored so read and write shapes
 * match. Timestamps are ISO strings because this crosses the server/client
 * boundary.
 */
export type BoardRecord = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  visibility: Board["visibility"];
  guestPosting: boolean;
  settings: BoardSettings;
  position: number;
  archivedAt: string | null;
  /** Non-archived, non-merged requests filed on this board. */
  postCount: number;
};
