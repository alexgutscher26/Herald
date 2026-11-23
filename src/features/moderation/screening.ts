import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  feedbackAttachments,
  feedbackComments,
  feedbackPosts,
  type ModerationChecks,
} from "@/db/schema";
import { findSensitiveInfo } from "@/features/public/sensitive";
import { getStorage } from "@/features/storage";

import { analyzeText } from "./analyze";
import { extractImageText, isSupportedImageMimeType } from "./image-text";

/**
 * Moderation screening.
 *
 * Text is always analyzed. Images are sent to the configured image-text
 * provider; an unconfigured or failing provider is recorded as `unavailable`
 * or `error`, which the submission path can treat as fail-closed. Only check
 * outcomes and finding categories are returned — the matched text, including
 * extracted image text, is discarded.
 */

export type ScreeningImage = {
  fileName: string;
  mimeType: string;
  body: Uint8Array;
};

export type ScreeningResult = {
  reasons: string[];
  checks: ModerationChecks;
  textSensitive: boolean;
  imageSensitive: boolean;
  /** An image existed but could not be inspected reliably. */
  imagesUnscanned: boolean;
};

export async function screenContent(input: {
  title?: string | null;
  body: string;
  images: ScreeningImage[];
  /** Attachments whose bytes could not be loaded from storage. */
  storageFailures?: number;
}): Promise<ScreeningResult> {
  const analysis = analyzeText({ title: input.title, body: input.body });
  const reasons = new Set<string>(analysis.reasons);
  const checks: ModerationChecks = {
    text: analysis.reasons.length > 0 ? "flagged" : "ok",
  };

  let imageSensitive = false;
  let imagesUnscanned = false;

  if (input.images.length > 0 || (input.storageFailures ?? 0) > 0) {
    let scanned = 0;
    let flagged = 0;
    let unavailable = 0;
    let errors = input.storageFailures ?? 0;

    if (errors > 0) reasons.add("scan_error");

    for (const image of input.images) {
      if (!isSupportedImageMimeType(image.mimeType)) {
        unavailable += 1;
        imagesUnscanned = true;
        reasons.add("scan_unavailable");
        continue;
      }

      const extracted = await extractImageText(image);
      if (extracted.ok) {
        scanned += 1;
        if (findSensitiveInfo(extracted.text).length > 0) {
          flagged += 1;
          imageSensitive = true;
          reasons.add("sensitive_info_image");
        }
      } else if (extracted.reason === "unavailable") {
        unavailable += 1;
        imagesUnscanned = true;
        reasons.add("scan_unavailable");
      } else {
        errors += 1;
        imagesUnscanned = true;
        reasons.add("scan_error");
      }
    }

    checks.images = { scanned, flagged, unavailable, errors };
  }

  checks.checkedAt = new Date().toISOString();

  return {
    reasons: [...reasons],
    checks,
    textSensitive: analysis.sensitiveFindings.length > 0,
    imageSensitive,
    imagesUnscanned,
  };
}

export type ReviewContent = {
  title: string | null;
  body: string;
  images: ScreeningImage[];
  storageFailures: number;
};

/**
 * Load the content behind a review and read its image attachments.
 *
 * Every row is scoped to the product, so a review whose content moved or was
 * deleted cannot pull another tenant's attachment into a scan.
 */
export async function loadReviewContent(input: {
  productId: string;
  contentType: "feedback_post" | "feedback_comment";
  contentId: string;
}): Promise<ReviewContent | null> {
  let title: string | null = null;
  let body: string;
  const attachmentRows: {
    fileName: string;
    mimeType: string;
    storageKey: string;
  }[] = [];

  if (input.contentType === "feedback_post") {
    const rows = await db
      .select({
        title: feedbackPosts.title,
        body: feedbackPosts.body,
      })
      .from(feedbackPosts)
      .where(
        and(
          eq(feedbackPosts.id, input.contentId),
          eq(feedbackPosts.productId, input.productId),
        ),
      )
      .limit(1);
    const post = rows[0];
    if (!post) return null;

    title = post.title;
    body = post.body;

    const attachments = await db
      .select({
        fileName: feedbackAttachments.fileName,
        mimeType: feedbackAttachments.mimeType,
        storageKey: feedbackAttachments.storageKey,
      })
      .from(feedbackAttachments)
      .where(
        and(
          eq(feedbackAttachments.feedbackPostId, input.contentId),
          eq(feedbackAttachments.productId, input.productId),
        ),
      );
    attachmentRows.push(...attachments);
  } else {
    const rows = await db
      .select({
        body: feedbackComments.body,
        postTitle: feedbackPosts.title,
      })
      .from(feedbackComments)
      .innerJoin(feedbackPosts, eq(feedbackComments.feedbackPostId, feedbackPosts.id))
      .where(
        and(
          eq(feedbackComments.id, input.contentId),
          eq(feedbackComments.productId, input.productId),
        ),
      )
      .limit(1);
    const comment = rows[0];
    if (!comment) return null;

    title = comment.postTitle;
    body = comment.body;

    const attachments = await db
      .select({
        fileName: feedbackAttachments.fileName,
        mimeType: feedbackAttachments.mimeType,
        storageKey: feedbackAttachments.storageKey,
      })
      .from(feedbackAttachments)
      .where(
        and(
          eq(feedbackAttachments.feedbackCommentId, input.contentId),
          eq(feedbackAttachments.productId, input.productId),
        ),
      );
    attachmentRows.push(...attachments);
  }

  const images: ScreeningImage[] = [];
  let storageFailures = 0;

  for (const attachment of attachmentRows) {
    if (!attachment.mimeType.startsWith("image/")) continue;
    if (!isSupportedImageMimeType(attachment.mimeType)) {
      // Present but not scannable; keep it in the list so the check records
      // `unavailable` rather than silently skipping the attachment.
      images.push({
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        body: new Uint8Array(),
      });
      continue;
    }

    try {
      const stored = await getStorage().get(attachment.storageKey);
      if (!stored) {
        storageFailures += 1;
        continue;
      }
      images.push({
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        body: stored.body,
      });
    } catch {
      storageFailures += 1;
    }
  }

  return { title, body, images, storageFailures };
}
