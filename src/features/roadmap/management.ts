import "server-only";

import { asc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { publicRoadmaps, roadmapBoards } from "@/db/schema";

export type RoadmapManagementItem = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  visibility: "public" | "unlisted";
  position: number;
  publishedAt: string | null;
  boardIds: string[];
};

export async function listRoadmapManagement(
  productId: string,
): Promise<RoadmapManagementItem[]> {
  const rows = await db
    .select()
    .from(publicRoadmaps)
    .where(eq(publicRoadmaps.productId, productId))
    .orderBy(asc(publicRoadmaps.position), asc(publicRoadmaps.name));

  if (rows.length === 0) return [];

  const links = await db
    .select({
      roadmapId: roadmapBoards.roadmapId,
      boardId: roadmapBoards.boardId,
    })
    .from(roadmapBoards)
    .where(inArray(roadmapBoards.roadmapId, rows.map((row) => row.id)));

  const boardsByRoadmap = new Map<string, string[]>();
  for (const link of links) {
    const list = boardsByRoadmap.get(link.roadmapId) ?? [];
    list.push(link.boardId);
    boardsByRoadmap.set(link.roadmapId, list);
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    visibility: row.visibility,
    position: row.position,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    boardIds: boardsByRoadmap.get(row.id) ?? [],
  }));
}
