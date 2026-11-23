"use client";

import { Ban, Download, FileUp, GitBranch, Link2, ListChecks, Save, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { now } from "@/lib/dates";

import { detectFormat, suggestMapping, validateMapping } from "./adapters";
import { deleteImportPresetAction, saveImportPresetAction } from "./actions";
import { parseCsv } from "./csv";
import { applyPresetMapping, presetApplies, type ImportPresetView } from "./presets";
import type { ImportPlan } from "./plan";
import {
  IMPORT_FIELDS,
  IMPORT_FIELD_HINTS,
  IMPORT_FIELD_LABELS,
  IMPORT_FORMAT_LABELS,
  IMPORT_FORMATS,
  IMPORT_SOURCES,
  IMPORT_SOURCE_LABELS,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  type ImportField,
  type ImportFormat,
  type ImportMapping,
  type ImportSource,
} from "./types";

/**
 * Import and export.
 *
 * Parsing in the browser exists only to show a mapping preview; the file is
 * uploaded intact and parsed again on the server. The mapping travels as data,
 * so a hand-written request cannot smuggle in an unknown column.
 */

export type ImportProgress = {
  id: string;
  fileName: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  source?: "csv" | "github" | "herald" | undefined;
  format?: ImportFormat | undefined;
  importedAttachments?: number | undefined;
  totalRows: number;
  processedRows: number;
  importedRows: number;
  skippedRows: number;
  failedRows: number;
  createdAt: string;
  completedAt: string | null;
  lastError: string | null;
  errors?: { rowNumber: number; status: string; message: string }[] | undefined;
};

const STATUS_TONES: Record<ImportProgress["status"], string> = {
  queued: "border-border bg-muted text-muted-foreground",
  running: "border-info/30 bg-info-muted text-info",
  completed: "border-success/30 bg-success-muted text-success",
  failed: "border-destructive/30 bg-destructive/10 text-destructive",
  cancelled: "border-border bg-muted text-muted-foreground",
};

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50";

function formatCount(value: number): string {
  return value.toLocaleString("en");
}

function formatWhen(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("en");
}

function progressPercent(item: ImportProgress): number {
  if (item.totalRows === 0) return 0;
  return Math.min(100, Math.round((item.processedRows / item.totalRows) * 100));
}

async function readProgress(
  workspaceSlug: string,
  productSlug: string,
  importId: string,
): Promise<ImportProgress | null> {
  const response = await fetch(
    `/api/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(productSlug)}/imports/${encodeURIComponent(importId)}`,
    { headers: { accept: "application/json" } },
  );
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => null)) as {
    import?: ImportProgress;
  } | null;
  return payload?.import ?? null;
}

export function ImportExportView({
  workspaceSlug,
  productSlug,
  boards,
  initialImports,
  presets,
}: {
  workspaceSlug: string;
  productSlug: string;
  boards: { id: string; name: string; slug: string; archivedAt: string | null }[];
  initialImports: ImportProgress[];
  presets: ImportPresetView[];
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<ImportProgress[]>(initialImports);
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<string[][]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [format, setFormat] = useState<ImportFormat>("generic");
  const [mapping, setMapping] = useState<ImportMapping>({});
  const [boardId, setBoardId] = useState(
    boards.find((board) => board.archivedAt === null)?.id ?? "",
  );
  const [fileError, setFileError] = useState("");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [report, setReport] = useState<ImportProgress | null>(null);
  const [presetList, setPresetList] = useState(presets);
  const [presetName, setPresetName] = useState("");
  const [presetError, setPresetError] = useState("");
  const [presetBusy, setPresetBusy] = useState(false);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [dryBusy, setDryBusy] = useState(false);
  const [sourceChoice, setSourceChoice] = useState<Exclude<ImportSource, "csv">>("github");
  const [repo, setRepo] = useState("");
  const [includeClosed, setIncludeClosed] = useState(true);
  const [sourceToken, setSourceToken] = useState("");
  const [heraldUrl, setHeraldUrl] = useState("");
  const [sourceBusy, setSourceBusy] = useState(false);
  const [sourceError, setSourceError] = useState("");
  const [sourcePlan, setSourcePlan] = useState<ImportPlan | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const active = items.find((item) => item.status === "queued" || item.status === "running");
  const activeId = active?.id ?? null;
  const activeStatus = active?.status ?? null;

  useEffect(() => {
    if (!activeId) return;

    let cancelled = false;
    const poll = async () => {
      const next = await readProgress(workspaceSlug, productSlug, activeId);
      if (cancelled || !next) return;
      setItems((current) =>
        current.map((item) => (item.id === next.id ? { ...item, ...next } : item)),
      );
      if (next.status === "failed" || (next.status === "completed" && next.failedRows > 0)) {
        setReport(next);
      }
    };

    const timer = window.setInterval(() => void poll(), 3_000);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeId, activeStatus, workspaceSlug, productSlug]);

  const mappingError = useMemo(() => {
    if (!file) return "";
    const check = validateMapping(headers, mapping);
    return check.ok ? "" : check.error;
  }, [file, headers, mapping]);

  async function chooseFile(selected: File | null) {
    setFileError("");
    setError("");
    setReport(null);
    setFile(null);
    setHeaders([]);
    setPreviewRows([]);
    setTotalRows(0);
    setMapping({});
    setPlan(null);

    if (!selected) return;
    if (selected.size > MAX_IMPORT_BYTES) {
      setFileError(
        `Choose a file under ${MAX_IMPORT_BYTES / (1024 * 1024)} MB. Large exports can be split by year.`,
      );
      return;
    }

    try {
      const parsed = parseCsv(await selected.text());
      if (parsed.rows.length > MAX_IMPORT_ROWS) {
        setFileError(
          `This file has ${formatCount(parsed.rows.length)} rows; import at most ${formatCount(MAX_IMPORT_ROWS)} at a time.`,
        );
        return;
      }
      if (parsed.rows.length === 0) {
        setFileError("The file has a header row but no data rows.");
        return;
      }

      const guessed = detectFormat(parsed.headers);
      setFile(selected);
      setHeaders(parsed.headers);
      setPreviewRows(parsed.rows.slice(0, 5));
      setTotalRows(parsed.rows.length);
      setFormat(guessed);
      setMapping(suggestMapping(parsed.headers, guessed));
    } catch (parseError) {
      setFileError(
        parseError instanceof Error ? parseError.message : "The file could not be read.",
      );
    }
  }

  function changeFormat(next: ImportFormat) {
    setFormat(next);
    setMapping(suggestMapping(headers, next));
    setPlan(null);
  }

  function changeMapping(field: ImportField, header: string) {
    setPlan(null);
    setMapping((current) => {
      const next = { ...current };
      if (header === "") delete next[field];
      else next[field] = header;
      return next;
    });
  }

  function csvForm(mapped: ImportMapping): FormData {
    const form = new FormData();
    if (file) form.set("file", file);
    form.set("format", format);
    form.set("boardId", boardId);
    form.set("mapping", JSON.stringify(mapped));
    return form;
  }

  async function checkCounts() {
    if (!file || dryBusy) return;
    setError("");
    setFileError("");
    setPlan(null);

    const check = validateMapping(headers, mapping);
    if (!check.ok) {
      setFileError(check.error);
      return;
    }
    if (boardId === "") {
      setError("Choose the board that imported requests belong to.");
      return;
    }

    setDryBusy(true);
    const form = csvForm(check.mapping);
    form.set("dryRun", "true");
    try {
      const response = await fetch(
        `/api/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(productSlug)}/imports`,
        { method: "POST", body: form },
      );
      const payload = (await response.json().catch(() => null)) as
        | { dryRun?: ImportPlan; error?: string }
        | null;
      if (!response.ok || !payload?.dryRun) {
        setError(payload?.error ?? "The dry run could not be completed.");
        return;
      }
      setPlan(payload.dryRun);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setDryBusy(false);
    }
  }

  async function savePreset() {
    if (presetBusy || headers.length === 0) return;
    setPresetError("");
    const check = validateMapping(headers, mapping);
    if (!check.ok) {
      setPresetError(check.error);
      return;
    }

    setPresetBusy(true);
    try {
      const result = await saveImportPresetAction({
        workspaceSlug,
        productSlug,
        name: presetName,
        format,
        headers,
        mapping: check.mapping as Record<string, string>,
      });
      if (!result.ok) {
        setPresetError(result.error);
        return;
      }
      setPresetList((current) => [
        result.data.preset,
        ...current.filter((preset) => preset.id !== result.data.preset.id),
      ]);
      setPresetName("");
    } finally {
      setPresetBusy(false);
    }
  }

  function applyPreset(preset: ImportPresetView) {
    setPresetError("");
    const next = applyPresetMapping(preset.mapping, headers);
    if (!next) {
      setPresetError("This preset needs a Title column that is not in the file.");
      return;
    }
    setFormat(preset.format);
    setMapping(next);
    setPlan(null);
  }

  async function removePreset(preset: ImportPresetView) {
    setPresetError("");
    const result = await deleteImportPresetAction({
      workspaceSlug,
      productSlug,
      presetId: preset.id,
    });
    if (!result.ok) {
      setPresetError(result.error);
      return;
    }
    setPresetList(result.data.presets);
  }

  async function startSourceImport(dryRun = false) {
    if (sourceBusy) return;
    setSourceError("");
    if (!dryRun) setSourcePlan(null);
    if (boardId === "") {
      setSourceError("Choose the board that imported requests belong to.");
      return;
    }
    if (sourceChoice === "github" && repo.trim() === "") {
      setSourceError("Enter a repository like owner/name.");
      return;
    }
    if (sourceChoice === "herald" && heraldUrl.trim() === "") {
      setSourceError("Enter the source Herald URL.");
      return;
    }

    setSourceBusy(true);
    try {
      const response = await fetch(
        `/api/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(productSlug)}/imports/source`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            source: sourceChoice,
            boardId,
            repo: repo.trim(),
            includeClosed,
            token: sourceToken,
            baseUrl: heraldUrl.trim(),
            dryRun,
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { import?: { id: string; totalRows: number }; dryRun?: ImportPlan; error?: string }
        | null;
      if (dryRun) {
        if (!response.ok || !payload?.dryRun) {
          setSourceError(payload?.error ?? "The dry run could not be completed.");
          return;
        }
        setSourcePlan(payload.dryRun);
        return;
      }
      if (!response.ok || !payload?.import) {
        setSourceError(payload?.error ?? "The source could not be imported.");
        return;
      }

      const queued: ImportProgress = {
        id: payload.import.id,
        fileName: sourceChoice === "github" ? `${repo.trim()} issues` : `${heraldUrl.trim()} requests`,
        status: "queued",
        source: sourceChoice,
        totalRows: payload.import.totalRows,
        processedRows: 0,
        importedRows: 0,
        skippedRows: 0,
        failedRows: 0,
        importedAttachments: 0,
        createdAt: now().toISOString(),
        completedAt: null,
        lastError: null,
      };
      setItems((current) => [queued, ...current]);
      setSourceToken("");
    } catch {
      setSourceError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSourceBusy(false);
    }
  }

  async function cancelImport(item: ImportProgress) {
    if (cancellingId) return;
    setCancellingId(item.id);
    try {
      const response = await fetch(
        `/api/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(productSlug)}/imports/${encodeURIComponent(item.id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "The import could not be cancelled.");
        return;
      }
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id ? { ...entry, status: "cancelled" } : entry,
        ),
      );
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setCancellingId(null);
    }
  }

  async function upload() {
    if (!file || uploading) return;
    setError("");
    setFileError("");

    const check = validateMapping(headers, mapping);
    if (!check.ok) {
      setFileError(check.error);
      return;
    }
    if (boardId === "") {
      setError("Choose the board that imported requests belong to.");
      return;
    }

    setUploading(true);

    const form = csvForm(check.mapping);

    try {
      const response = await fetch(
        `/api/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(productSlug)}/imports`,
        { method: "POST", body: form },
      );
      const payload = (await response.json().catch(() => null)) as
        | { import?: { id: string; totalRows: number; status: "queued" }; error?: string }
        | null;

      if (!response.ok || !payload?.import) {
        setError(payload?.error ?? "The import could not be started.");
        return;
      }

      const queued: ImportProgress = {
        id: payload.import.id,
        fileName: file.name,
        status: "queued",
        totalRows: payload.import.totalRows,
        processedRows: 0,
        importedRows: 0,
        skippedRows: 0,
        failedRows: 0,
        createdAt: now().toISOString(),
        completedAt: null,
        lastError: null,
      };

      setItems((current) => [queued, ...current.filter((item) => item.id !== queued.id)]);
      setFile(null);
      setHeaders([]);
      setPreviewRows([]);
      setTotalRows(0);
      setMapping({});
      if (fileInput.current) fileInput.current.value = "";
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setUploading(false);
    }
  }

  async function openReport(item: ImportProgress) {
    if (item.errors) {
      setReport(item);
      return;
    }
    const detail = await readProgress(workspaceSlug, productSlug, item.id);
    if (detail) {
      setReport(detail);
      setItems((current) =>
        current.map((entry) => (entry.id === detail.id ? { ...entry, ...detail } : entry)),
      );
    }
  }

  const titleMapped = mapping.title !== undefined;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardContent className="space-y-5 p-5">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                <FileUp className="size-4" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-foreground">Import feedback from CSV</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Bring requests over from Canny, Productboard, Nolt, Frill, Beamer or any CSV.
                  Images named by a public URL are copied into storage, and the file is processed
                  in the background so you can leave this page.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="import-file">CSV file</Label>
              <input
                ref={fileInput}
                id="import-file"
                type="file"
                accept=".csv,text/csv,text/plain"
                onChange={(event) => void chooseFile(event.target.files?.[0] ?? null)}
                aria-invalid={Boolean(fileError)}
                aria-describedby={fileError ? "import-file-error" : undefined}
                className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:bg-card file:px-3 file:py-1.5 file:text-sm file:font-medium"
              />
              <p className="text-xs text-muted-foreground">
                Up to {MAX_IMPORT_BYTES / (1024 * 1024)} MB or {formatCount(MAX_IMPORT_ROWS)} rows.
                The first row must be the header row.
              </p>
              {fileError ? (
                <p id="import-file-error" role="alert" className="text-xs text-destructive">
                  {fileError}
                </p>
              ) : null}
            </div>

            {file ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="import-format">Source format</Label>
                    <select
                      id="import-format"
                      className={SELECT_CLASS}
                      value={format}
                      onChange={(event) => changeFormat(event.target.value as ImportFormat)}
                    >
                      {IMPORT_FORMATS.map((option) => (
                        <option key={option} value={option}>
                          {IMPORT_FORMAT_LABELS[option]}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground">
                      Format presets only suggest columns and translate statuses.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="import-board">Default board</Label>
                    <select
                      id="import-board"
                      className={SELECT_CLASS}
                      value={boardId}
                      onChange={(event) => {
                        setBoardId(event.target.value);
                        setPlan(null);
                      }}
                    >
                      <option value="">Choose a board</option>
                      {boards.map((board) => (
                        <option key={board.id} value={board.id}>
                          {board.name}
                          {board.archivedAt ? " (archived)" : ""}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground">
                      Used for rows whose board column is blank.
                    </p>
                  </div>
                </div>

                <section aria-labelledby="mapping-heading" className="space-y-3 border-t pt-4">
                  <div>
                    <h3 id="mapping-heading" className="text-sm font-semibold text-foreground">
                      Column mapping
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatCount(totalRows)} data rows · {headers.length} columns. A column can
                      feed one field; Title is required.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {IMPORT_FIELDS.map((field) => (
                      <div key={field} className="space-y-1.5">
                        <Label htmlFor={`map-${field}`}>
                          {IMPORT_FIELD_LABELS[field]}
                          {field === "title" ? " (required)" : ""}
                        </Label>
                        <select
                          id={`map-${field}`}
                          className={SELECT_CLASS}
                          value={mapping[field] ?? ""}
                          onChange={(event) => changeMapping(field, event.target.value)}
                        >
                          <option value="">Not mapped</option>
                          {headers.map((header) => {
                            const usedBy = IMPORT_FIELDS.find(
                              (other) => other !== field && mapping[other] === header,
                            );
                            return (
                              <option key={header} value={header}>
                                {header}
                                {usedBy ? ` (${IMPORT_FIELD_LABELS[usedBy]})` : ""}
                              </option>
                            );
                          })}
                        </select>
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                          {IMPORT_FIELD_HINTS[field]}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>

                <section aria-labelledby="preset-heading" className="space-y-2 border-t pt-4">
                  <h3 id="preset-heading" className="text-sm font-semibold text-foreground">
                    Remembered mappings
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Saved for this workspace and matched by the file&apos;s columns. Saving the same
                    column set again replaces it.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={presetName}
                      onChange={(event) => setPresetName(event.target.value)}
                      placeholder="Name this mapping"
                      maxLength={80}
                      className="h-8 w-56 rounded-md border border-input bg-background px-2 text-sm shadow-sm"
                      aria-label="Preset name"
                      aria-invalid={Boolean(presetError)}
                      aria-describedby={presetError ? "import-preset-error" : undefined}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void savePreset()}
                      disabled={presetBusy || presetName.trim().length < 2 || !titleMapped}
                    >
                      <Save aria-hidden="true" />
                      {presetBusy ? "Saving…" : "Save mapping"}
                    </Button>
                  </div>
                  {presetError ? (
                    <p id="import-preset-error" role="alert" className="text-xs text-destructive">
                      {presetError}
                    </p>
                  ) : null}
                  {presetList.length > 0 ? (
                    <ul className="divide-y rounded-md border text-xs">
                      {presetList.map((preset) => (
                        <li
                          key={preset.id}
                          className="flex flex-wrap items-center gap-2 px-2 py-1.5"
                        >
                          <span className="font-medium text-foreground">{preset.name}</span>
                          <span className="text-muted-foreground">
                            {IMPORT_FORMAT_LABELS[preset.format]}
                            {presetApplies(preset, headers) ? " · columns match" : ""}
                          </span>
                          <span className="ml-auto flex items-center gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => applyPreset(preset)}
                              disabled={!presetApplies(preset, headers)}
                            >
                              Apply
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="size-7"
                              aria-label={`Delete preset ${preset.name}`}
                              onClick={() => void removePreset(preset)}
                            >
                              <Trash2 aria-hidden="true" />
                            </Button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>

                {previewRows.length > 0 ? (
                  <section aria-labelledby="preview-heading" className="space-y-2 border-t pt-4">
                    <h3 id="preview-heading" className="text-sm font-semibold text-foreground">
                      Preview
                    </h3>
                    <div className="overflow-x-auto rounded-md border">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-muted/50 text-muted-foreground">
                          <tr>
                            {headers.map((header) => (
                              <th key={header} scope="col" className="whitespace-nowrap px-2 py-1.5 font-medium">
                                {header}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {previewRows.map((row, index) => (
                            <tr key={index} className="border-t">
                              {headers.map((header, column) => (
                                <td key={header} className="max-w-48 truncate px-2 py-1.5">
                                  {row[column] ?? ""}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                ) : null}

                {plan ? (
                  <section
                    aria-labelledby="dry-run-heading"
                    className="space-y-1 rounded-md border bg-muted/20 p-3"
                  >
                    <h3 id="dry-run-heading" className="text-sm font-semibold text-foreground">
                      Dry run · nothing written
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {formatCount(plan.importable)} of {formatCount(plan.totalRows)} rows would
                      import · {formatCount(plan.failed)} would fail ·{" "}
                      {formatCount(plan.skipped)} skipped · {formatCount(plan.warnings)} warnings
                    </p>
                    {plan.issues.length > 0 ? (
                      <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                        {plan.issues.slice(0, 10).map((issue) => (
                          <li key={`${issue.rowNumber}-${issue.message}`}>
                            <span className={issue.status === "failed" ? "text-destructive" : ""}>
                              Row {issue.rowNumber}
                            </span>{" "}
                            · {issue.message}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </section>
                ) : null}

                {error ? (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                ) : null}

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void checkCounts()}
                    disabled={dryBusy || !titleMapped}
                  >
                    <ListChecks aria-hidden="true" />
                    {dryBusy ? "Checking…" : "Check counts"}
                  </Button>
                  <Button type="button" onClick={() => void upload()} disabled={uploading || !titleMapped}>
                    <Upload aria-hidden="true" />
                    {uploading ? "Starting…" : "Start import"}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {mappingError || "Rows with errors are reported and skipped."}
                  </p>
                </div>
              </>
            ) : error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                <Download className="size-4" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-foreground">Export your data</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Download every request, comment, vote, follower and merge record for this
                  product. Merged duplicates keep their canonical request id.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Button asChild variant="outline" className="w-full justify-start">
                <a href={`/api/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(productSlug)}/export?format=json`}>
                  <Download aria-hidden="true" />
                  Everything (JSON)
                </a>
              </Button>
              <Button asChild variant="outline" className="w-full justify-start">
                <a href={`/api/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(productSlug)}/export?format=csv`}>
                  <Download aria-hidden="true" />
                  Requests (CSV)
                </a>
              </Button>
            </div>

            <p className="text-xs leading-relaxed text-muted-foreground">
              Exports include internal comments and customer email addresses because they are
              your workspace&apos;s data. Handle the download accordingly.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
              {sourceChoice === "github" ? (
                <GitBranch className="size-4" aria-hidden="true" />
              ) : (
                <Link2 className="size-4" aria-hidden="true" />
              )}
            </span>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Import from an API</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Pull issues from a GitHub repository, or requests from another Herald workspace.
                When this product has a GitHub App installation, private repositories use a
                short-lived installation token instead of a personal token. Tokens are used for
                this request only and are never stored. Images found in issue or request bodies are
                fetched once, with private addresses refused.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="source-kind">Source</Label>
              <select
                id="source-kind"
                className={SELECT_CLASS}
                value={sourceChoice}
                onChange={(event) => {
                  setSourceChoice(event.target.value as Exclude<ImportSource, "csv">);
                  setSourceError("");
                  setSourcePlan(null);
                }}
              >
                {IMPORT_SOURCES.filter((source) => source !== "csv").map((source) => (
                  <option key={source} value={source}>
                    {IMPORT_SOURCE_LABELS[source]}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="source-board">Default board</Label>
              <select
                id="source-board"
                className={SELECT_CLASS}
                value={boardId}
                onChange={(event) => setBoardId(event.target.value)}
              >
                <option value="">Choose a board</option>
                {boards.map((board) => (
                  <option key={board.id} value={board.id}>
                    {board.name}
                    {board.archivedAt ? " (archived)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {sourceChoice === "github" ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="github-repo">Repository</Label>
                  <input
                    id="github-repo"
                    value={repo}
                    onChange={(event) => setRepo(event.target.value)}
                    placeholder="owner/name"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="github-token">Personal token (optional)</Label>
                  <input
                    id="github-token"
                    type="password"
                    autoComplete="off"
                    value={sourceToken}
                    onChange={(event) => setSourceToken(event.target.value)}
                    placeholder="Leave blank to use the connected GitHub App"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={includeClosed}
                  onChange={(event) => setIncludeClosed(event.target.checked)}
                />
                Include closed issues
              </label>
            </>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="herald-url">Source Herald URL</Label>
                <input
                  id="herald-url"
                  value={heraldUrl}
                  onChange={(event) => setHeraldUrl(event.target.value)}
                  placeholder="https://feedback.example.com"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="herald-token">API token</Label>
                <input
                  id="herald-token"
                  type="password"
                  autoComplete="off"
                  value={sourceToken}
                  onChange={(event) => setSourceToken(event.target.value)}
                  placeholder="Read scope token from that workspace"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm"
                />
              </div>
            </div>
          )}

          {sourcePlan ? (
            <section
              aria-labelledby="source-dry-heading"
              className="space-y-1 rounded-md border bg-muted/20 p-3"
            >
              <h3 id="source-dry-heading" className="text-sm font-semibold text-foreground">
                Dry run · nothing written
              </h3>
              <p className="text-xs text-muted-foreground">
                {formatCount(sourcePlan.importable)} of {formatCount(sourcePlan.totalRows)} rows
                would import · {formatCount(sourcePlan.failed)} would fail ·{" "}
                {formatCount(sourcePlan.skipped)} skipped
              </p>
            </section>
          ) : null}

          {sourceError ? (
            <p role="alert" className="text-sm text-destructive">
              {sourceError}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => void startSourceImport(true)}
              disabled={sourceBusy || boardId === ""}
            >
              <ListChecks aria-hidden="true" />
              {sourceBusy ? "Fetching…" : "Check counts"}
            </Button>
            <Button
              type="button"
              onClick={() => void startSourceImport()}
              disabled={sourceBusy || boardId === ""}
            >
              <Upload aria-hidden="true" />
              {sourceBusy ? "Fetching…" : "Start import"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-5">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Recent imports</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Background jobs run on the cron schedule. Progress updates automatically.
            </p>
          </div>

          {items.length === 0 ? (
            <p className="rounded-md border border-dashed bg-muted/30 px-3 py-6 text-center text-sm text-muted-foreground">
              No imports yet. Start with a CSV above.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {items.map((item) => (
                <li key={item.id} className="space-y-2 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{item.fileName}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatWhen(item.createdAt)} · {formatCount(item.totalRows)} rows
                      </p>
                    </div>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_TONES[item.status]}`}
                    >
                      {item.status === "running"
                        ? "Importing"
                        : item.status === "queued"
                          ? "Queued"
                          : item.status === "completed"
                            ? "Completed"
                            : item.status === "cancelled"
                              ? "Cancelled"
                              : "Failed"}
                    </span>
                  </div>

                  <div
                    role="progressbar"
                    aria-label={`Import progress for ${item.fileName}`}
                    aria-valuemin={0}
                    aria-valuemax={Math.max(1, item.totalRows)}
                    aria-valuenow={item.processedRows}
                    className="h-1.5 overflow-hidden rounded-full bg-muted"
                  >
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${progressPercent(item)}%` }}
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      {formatCount(item.processedRows)} / {formatCount(item.totalRows)} processed
                    </span>
                    <span>{formatCount(item.importedRows)} imported</span>
                    <span>{formatCount(item.failedRows)} failed</span>
                    {item.importedAttachments ? (
                      <span>{formatCount(item.importedAttachments)} images</span>
                    ) : null}
                    {item.lastError ? (
                      <span className="text-destructive">{item.lastError}</span>
                    ) : null}
                    {item.failedRows > 0 || item.status === "failed" ? (
                      <button
                        type="button"
                        onClick={() => void openReport(item)}
                        className="font-medium text-primary hover:underline"
                      >
                        View report
                      </button>
                    ) : null}
                    {item.status === "queued" || item.status === "running" ? (
                      <button
                        type="button"
                        onClick={() => void cancelImport(item)}
                        disabled={cancellingId === item.id}
                        className="inline-flex items-center gap-1 font-medium text-destructive hover:underline disabled:opacity-50"
                      >
                        <Ban aria-hidden="true" className="size-3" />
                        {cancellingId === item.id ? "Cancelling…" : "Cancel"}
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {report ? (
            <section aria-labelledby="report-heading" className="rounded-md border bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 id="report-heading" className="text-sm font-semibold text-foreground">
                  Report: {report.fileName}
                </h3>
                <Button type="button" variant="ghost" size="sm" onClick={() => setReport(null)}>
                  Close
                </Button>
              </div>
              {report.errors && report.errors.length > 0 ? (
                <ul className="mt-2 space-y-1 text-xs">
                  {report.errors.map((problem) => (
                    <li key={`${problem.rowNumber}-${problem.message}`} className="text-muted-foreground">
                      <span className="font-medium text-foreground">Row {problem.rowNumber}</span> ·{" "}
                      {problem.message}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  No row errors were recorded. {formatCount(report.importedRows)} requests imported.
                </p>
              )}
            </section>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
