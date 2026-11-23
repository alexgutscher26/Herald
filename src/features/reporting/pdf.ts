import { metricLabel } from "./catalogue";

/**
 * Minimal PDF writer for report exports.
 *
 * A report is text and a table, so pulling in a PDF engine (and its font and
 * licensing surface) is unnecessary. This emits a valid PDF 1.4 document with
 * Helvetica, one table row per metric and a daily detail section, paginated at
 * 44 lines. Text is transliterated to ASCII; the report name remains readable
 * and the file opens in every viewer.
 */

export type ReportPdfInput = {
  reportName: string;
  datasetLabel: string;
  from: string;
  to: string;
  metrics: readonly string[];
  datasetKey: string;
  totals: Record<string, number>;
  previousTotals: Record<string, number> | null;
  comparison: Record<string, number | null>;
  series: ReadonlyArray<{ day: string; metrics: Record<string, number> }>;
};

const LINES_PER_PAGE = 44;
const LEFT = 48;
const TOP = 760;
const LINE_HEIGHT = 15;

function ascii(value: string): string {
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u00a0/g, " ")
    .replace(/[^\x20-\x7e]/g, "?");
}

function escapePdf(value: string): string {
  return ascii(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value.padEnd(width, " ");
}

function formatChange(value: number | null): string {
  return value === null ? "-" : `${value.toFixed(1)}%`;
}

function buildLines(input: ReportPdfInput): string[] {
  const lines: string[] = [];
  const header = `Metric`.padEnd(30) + "Total".padStart(10) + "Previous".padStart(12) + "Change".padStart(11);
  lines.push("SAVED REPORT");
  lines.push(input.reportName);
  lines.push(`${input.datasetLabel} | ${input.from} to ${input.to}`);
  lines.push("");
  lines.push(header);
  lines.push("-".repeat(header.length));

  for (const metric of input.metrics) {
    const label = metricLabel(input.datasetKey, metric);
    const total = input.totals[metric] ?? 0;
    const previous = input.previousTotals ? (input.previousTotals[metric] ?? 0) : null;
    lines.push(
      pad(label, 30) +
        String(total).padStart(10) +
        (previous === null ? "-" : String(previous)).padStart(12) +
        formatChange(input.comparison[metric] ?? null).padStart(11),
    );
  }

  lines.push("");
  lines.push("DAILY DETAIL");
  lines.push(pad("Day", 12) + pad("Metric", 30) + "Value".padStart(10));
  lines.push("-".repeat(52));
  for (const point of input.series) {
    for (const metric of input.metrics) {
      lines.push(
        pad(point.day, 12) +
          pad(metricLabel(input.datasetKey, metric), 30) +
          String(point.metrics[metric] ?? 0).padStart(10),
      );
    }
  }
  return lines;
}

function contentStream(lines: readonly string[]): string {
  const body = ["BT", "/F1 10 Tf", `${LEFT} ${TOP} Td`, `${LINE_HEIGHT} TL`];
  for (const line of lines) {
    body.push(`(${escapePdf(line)}) Tj`, "T*");
  }
  body.push("ET");
  return body.join("\n");
}

/** Build a complete PDF file as bytes. */
export function buildReportPdf(input: ReportPdfInput): Uint8Array {
  const allLines = buildLines(input);
  const pages: string[][] = [];
  for (let index = 0; index < allLines.length; index += LINES_PER_PAGE) {
    pages.push(allLines.slice(index, index + LINES_PER_PAGE));
  }
  if (pages.length === 0) pages.push(["No data"]);

  const objects: string[] = [];
  const pageObjectIds: number[] = [];
  // 1 catalog, 2 page tree, 3 font, then page/content pairs.
  const firstPageId = 4;
  for (let index = 0; index < pages.length; index += 1) {
    pageObjectIds.push(firstPageId + index * 2);
  }
  const fontId = 3;
  const pageTreeId = 2;

  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  );
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  pages.forEach((lines, index) => {
    const pageId = firstPageId + index * 2;
    const contentId = pageId + 1;
    const stream = contentStream(lines);
    objects.push(
      `<< /Type /Page /Parent ${pageTreeId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    objects.push(
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  });

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  // The document is ASCII by construction, so one character is one byte.
  const bytes = new Uint8Array(pdf.length);
  for (let index = 0; index < pdf.length; index += 1) {
    bytes[index] = pdf.charCodeAt(index) & 0xff;
  }
  return bytes;
}
