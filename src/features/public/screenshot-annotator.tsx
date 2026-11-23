"use client";

import {
  Camera,
  ClipboardPaste,
  PenLine,
  Square,
  Trash2,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { usePublicI18n } from "./i18n/provider";

/**
 * Screen capture with a small annotation canvas.
 *
 * The screenshot never leaves the browser until the form is submitted: drawing
 * happens on a local canvas, and the result is added to the same attachment
 * list the file input uses. `getDisplayMedia` is optional; paste and the normal
 * file picker remain available when the host or browser blocks screen capture.
 */

type Point = { x: number; y: number };
type Tool = "pen" | "box";
type Stroke = {
  tool: Tool;
  color: string;
  width: number;
  points: Point[];
};

const COLORS = [
  { value: "#dc2626", label: "screenshot.red" },
  { value: "#eab308", label: "screenshot.yellow" },
  { value: "#2563eb", label: "screenshot.blue" },
] as const;

const MAX_CAPTURE_WIDTH = 1800;

function drawStroke(
  context: CanvasRenderingContext2D,
  stroke: Stroke,
): void {
  if (stroke.points.length === 0) return;
  context.save();
  context.strokeStyle = stroke.color;
  context.lineWidth = stroke.width;
  context.lineCap = "round";
  context.lineJoin = "round";

  if (stroke.tool === "pen") {
    const [first, ...rest] = stroke.points;
    if (!first) {
      context.restore();
      return;
    }
    context.beginPath();
    context.moveTo(first.x, first.y);
    for (const point of rest) context.lineTo(point.x, point.y);
    if (rest.length === 0) {
      context.lineTo(first.x + 0.1, first.y + 0.1);
    }
    context.stroke();
  } else {
    const start = stroke.points[0];
    const end = stroke.points[1] ?? start;
    if (start && end) {
      context.strokeRect(
        Math.min(start.x, end.x),
        Math.min(start.y, end.y),
        Math.abs(end.x - start.x),
        Math.abs(end.y - start.y),
      );
    }
  }

  context.restore();
}

function paint(
  canvas: HTMLCanvasElement,
  source: HTMLCanvasElement,
  strokes: Stroke[],
  draft: Stroke | null,
): void {
  const context = canvas.getContext("2d");
  if (!context) return;

  if (canvas.width !== source.width) canvas.width = source.width;
  if (canvas.height !== source.height) canvas.height = source.height;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0);
  for (const stroke of strokes) drawStroke(context, stroke);
  if (draft) drawStroke(context, draft);
}

function canvasFromVideo(video: HTMLVideoElement): HTMLCanvasElement {
  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;
  const scale = Math.min(1, MAX_CAPTURE_WIDTH / width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available.");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function canvasFromBlob(blob: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, MAX_CAPTURE_WIDTH / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));

  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Canvas is not available.");
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

export function ScreenshotAnnotator({
  disabled,
  onAdd,
}: {
  disabled?: boolean;
  onAdd: (file: File) => void;
}) {
  const { t } = usePublicI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [source, setSource] = useState<HTMLCanvasElement | null>(null);
  const [open, setOpen] = useState(false);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState<string>(COLORS[0].value);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [draft, setDraft] = useState<Stroke | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !source || !open) return;
    paint(canvas, source, strokes, draft);
  }, [source, open, strokes, draft]);

  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      if (disabled || open) return;
      const item = Array.from(event.clipboardData?.items ?? []).find((entry) =>
        entry.type.startsWith("image/"),
      );
      const file = item?.getAsFile();
      if (!file) return;

      event.preventDefault();
      void canvasFromBlob(file)
        .then(openSource)
        .catch(() => setError(t("screenshot.error")));
    }

    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [disabled, open, t]);

  function reset() {
    setOpen(false);
    setSource(null);
    setStrokes([]);
    setDraft(null);
    setSaving(false);
  }

  function openSource(next: HTMLCanvasElement) {
    setSource(next);
    setStrokes([]);
    setDraft(null);
    setError("");
    setOpen(true);
  }

  async function capture() {
    setError("");
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError(t("screenshot.unsupported"));
      return;
    }

    setCapturing(true);
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
      openSource(canvasFromVideo(video));
    } catch (captureError) {
      const name = captureError instanceof Error ? captureError.name : "";
      setError(
        name === "NotAllowedError"
          ? t("screenshot.permission")
          : t("screenshot.error"),
      );
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      setCapturing(false);
    }
  }

  async function pasteImage() {
    setError("");
    if (!navigator.clipboard?.read) {
      setError(t("screenshot.unsupported"));
      return;
    }

    setReading(true);
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((value) => value.startsWith("image/"));
        if (!type) continue;
        const blob = await item.getType(type);
        openSource(await canvasFromBlob(blob));
        return;
      }
      setError(t("screenshot.clipboardError"));
    } catch {
      setError(t("screenshot.clipboardError"));
    } finally {
      setReading(false);
    }
  }

  function pointFor(event: React.PointerEvent<HTMLCanvasElement>): Point {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function beginStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!source || !canvasRef.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFor(event);
    setDraft({
      tool,
      color,
      width: Math.max(2, Math.round(source.width / 400)),
      points: [point, point],
    });
  }

  function continueStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!draft) return;
    event.preventDefault();
    const point = pointFor(event);
    setDraft((current) => {
      if (!current) return current;
      if (current.tool === "pen") {
        return { ...current, points: [...current.points, point] };
      }
      return { ...current, points: [current.points[0] ?? point, point] };
    });
  }

  function finishStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!draft) return;
    event.preventDefault();
    setStrokes((current) => [...current, draft]);
    setDraft(null);
  }

  function attach() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSaving(true);
    canvas.toBlob((blob) => {
      setSaving(false);
      if (!blob) {
        setError(t("screenshot.error"));
        return;
      }
      const file = new File([blob], `screenshot-${Date.now()}.png`, {
        type: "image/png",
      });
      onAdd(file);
      reset();
    }, "image/png");
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void capture()}
          disabled={disabled || capturing}
        >
          <Camera aria-hidden="true" />
          {capturing ? t("screenshot.capturing") : t("screenshot.capture")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void pasteImage()}
          disabled={disabled || reading}
        >
          <ClipboardPaste aria-hidden="true" />
          {reading ? t("screenshot.reading") : t("screenshot.paste")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("submit.screenshotHint")}
      </p>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) reset();
        }}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t("screenshot.title")}</DialogTitle>
            <DialogDescription>{t("screenshot.description")}</DialogDescription>
          </DialogHeader>

          <div className="max-h-[65vh] overflow-auto rounded-md border bg-muted p-2">
            <canvas
              ref={canvasRef}
              className="block h-auto w-full cursor-crosshair touch-none rounded"
              onPointerDown={beginStroke}
              onPointerMove={continueStroke}
              onPointerUp={finishStroke}
              onPointerCancel={() => setDraft(null)}
              aria-label={t("screenshot.title")}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={tool === "pen" ? "default" : "outline"}
              aria-pressed={tool === "pen"}
              onClick={() => setTool("pen")}
            >
              <PenLine aria-hidden="true" />
              {t("screenshot.pen")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={tool === "box" ? "default" : "outline"}
              aria-pressed={tool === "box"}
              onClick={() => setTool("box")}
            >
              <Square aria-hidden="true" />
              {t("screenshot.box")}
            </Button>
            <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
            {COLORS.map((entry) => (
              <button
                key={entry.value}
                type="button"
                aria-label={t(entry.label)}
                aria-pressed={color === entry.value}
                onClick={() => setColor(entry.value)}
                className={`size-7 rounded-full border-2 ${
                  color === entry.value
                    ? "border-foreground"
                    : "border-transparent"
                }`}
                style={{ backgroundColor: entry.value }}
              />
            ))}
            <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setStrokes((current) => current.slice(0, -1))}
              disabled={strokes.length === 0}
            >
              <Undo2 aria-hidden="true" />
              {t("screenshot.undo")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setStrokes([])}
              disabled={strokes.length === 0}
            >
              <Trash2 aria-hidden="true" />
              {t("screenshot.clear")}
            </Button>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={reset}>
              {t("screenshot.cancel")}
            </Button>
            <Button type="button" onClick={attach} disabled={saving}>
              {saving ? t("screenshot.attaching") : t("screenshot.attach")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
