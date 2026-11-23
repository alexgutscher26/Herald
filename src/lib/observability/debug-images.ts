import { openSync, readSync, closeSync, statSync } from "node:fs";
import { join } from "node:path";

import type { SentryFrame } from "./sentry";

/**
 * Debug ids for uploaded server chunks.
 *
 * Symbolication needs `debug_meta.images` on the event: the source-map upload
 * keys each artifact by the debug id that was injected into the chunk, so the
 * collector cannot match a frame to its map without it. The injected
 * `//# debugId=` comment at the end of the chunk is the same id, so it is read
 * from disk once per chunk and cached.
 */

export type DebugImage = {
  type: "sourcemap";
  code_file: string;
  debug_id: string;
};

const ARTIFACT_PREFIX = "app:///_next/server/";
const TAIL_BYTES = 1_024;
const cache = new Map<string, string | null>();

function readDebugId(artifact: string): string | null {
  const cached = cache.get(artifact);
  if (cached !== undefined) return cached;

  let debugId: string | null = null;
  try {
    const path = join(process.cwd(), ".next", "server", artifact.slice(ARTIFACT_PREFIX.length));
    const { size } = statSync(path);
    const length = Math.min(TAIL_BYTES, size);
    const tail = Buffer.alloc(length);
    const fd = openSync(path, "r");
    try {
      readSync(fd, tail, 0, length, size - length);
    } finally {
      closeSync(fd);
    }
    debugId = /\/\/# debugId=([0-9a-f-]{36})/.exec(tail.toString("utf8"))?.[1] ?? null;
  } catch {
    // A chunk that is not on disk (dev server, different build layout) simply
    // sends no image; the frame stays as it is.
    debugId = null;
  }

  cache.set(artifact, debugId);
  return debugId;
}

/** Debug images for the server frames of one event, one entry per chunk. */
export function debugImagesForFrames(frames: SentryFrame[]): DebugImage[] {
  const images: DebugImage[] = [];
  const seen = new Set<string>();

  for (const frame of frames) {
    const file = frame.filename;
    if (!file?.startsWith(ARTIFACT_PREFIX) || seen.has(file)) continue;
    seen.add(file);
    const debugId = readDebugId(file);
    if (debugId) images.push({ type: "sourcemap", code_file: file, debug_id: debugId });
  }

  return images;
}
