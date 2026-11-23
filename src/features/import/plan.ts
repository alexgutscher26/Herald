import { mapStatus, parseCreatedAt } from "./adapters";
import {
  cleanCell,
  rowToData,
  type ImportMapping,
  type ImportRowData,
} from "./types";

/**
 * Dry-run planning.
 *
 * The same mapping, title and board rules the job applies are evaluated here
 * without writing anything. A dry run therefore answers "how many would land?"
 * before the upload creates an import row, a job or a feedback post.
 */

export type ImportIssue = {
  rowNumber: number;
  status: "failed" | "warning";
  message: string;
};

export type ImportPlan = {
  totalRows: number;
  importable: number;
  skipped: number;
  failed: number;
  warnings: number;
  issues: ImportIssue[];
};

export function resolveBoardLabel(input: {
  requested: string;
  fallbackBoardId: string | null;
  boardMap: Map<string, string>;
  archived: Set<string>;
}): { ok: true; boardId: string } | { ok: false; error: string } {
  const requested = cleanCell(input.requested);

  if (requested === "") {
    return input.fallbackBoardId
      ? { ok: true, boardId: input.fallbackBoardId }
      : { ok: false, error: "No board was chosen for this import." };
  }

  const key = requested
    .toLowerCase()
    .replace(/^https?:\/\/[^/]+\/p\/[^/]+\/[^/]+\//, "")
    .replace(/^\/+|\/+$/g, "");

  const boardId = input.boardMap.get(key);
  if (!boardId) {
    return {
      ok: false,
      error: `Board "${requested.slice(0, 80)}" was not found in this product.`,
    };
  }
  if (input.archived.has(boardId)) {
    return { ok: false, error: `Board "${requested.slice(0, 80)}" is archived.` };
  }
  return { ok: true, boardId };
}

export function planImportRows(input: {
  headers: string[];
  rows: string[][];
  mapping: ImportMapping;
  fallbackBoardId: string | null;
  boardMap: Map<string, string>;
  archived: Set<string>;
}): ImportPlan {
  let importable = 0;
  let skipped = 0;
  let failed = 0;
  let warnings = 0;
  const issues: ImportIssue[] = [];

  const issue = (rowNumber: number, status: ImportIssue["status"], message: string) => {
    if (issues.length < 50) issues.push({ rowNumber, status, message });
  };

  input.rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const data = rowToData(input.headers, row, input.mapping);
    if (Object.keys(data).length === 0) {
      skipped += 1;
      return;
    }

    if (cleanCell(data.title).length === 0) {
      failed += 1;
      issue(rowNumber, "failed", "The row has no title.");
      return;
    }

    const board = resolveBoardLabel({
      requested: data.board ?? "",
      fallbackBoardId: input.fallbackBoardId,
      boardMap: input.boardMap,
      archived: input.archived,
    });
    if (!board.ok) {
      failed += 1;
      issue(rowNumber, "failed", board.error);
      return;
    }

    importable += 1;

    if (data.status && mapStatus(data.status) === null) {
      warnings += 1;
      issue(rowNumber, "warning", `Status "${data.status}" is not recognized; it will import as Open.`);
    }
    if (data.createdAt && parseCreatedAt(data.createdAt) === null) {
      warnings += 1;
      issue(rowNumber, "warning", `Date "${data.createdAt}" is not recognized; the import time is used.`);
    }
  });

  return {
    totalRows: input.rows.length,
    importable,
    skipped,
    failed,
    warnings,
    issues,
  };
}

/** First image in a Markdown or HTML body, used as an imported cover. */
export function firstImageUrl(body: string): string | null {
  const markdown = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/i.exec(body);
  if (markdown?.[1]) return markdown[1];
  const html = /<img\b[^>]*\bsrc\s*=\s*["'](https?:\/\/[^"']+)["']/i.exec(body);
  return html?.[1] ?? null;
}

export type { ImportRowData };
