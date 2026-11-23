/**
 * API cursor compatibility layer.
 *
 * The cursor format lives in `@/lib/pagination` so the dashboard, public
 * readers and the API cannot drift into three encodings. This module keeps the
 * existing `@/features/api-v1/cursor` import path for API code and tests.
 */

export {
  decodeCursor,
  encodeCursor,
  isUuid,
  type CursorPayload,
} from "@/lib/pagination";
