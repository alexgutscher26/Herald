"use client";

import Image from "next/image";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type PendingInlineImage = {
  key: string;
  url: string;
  fileName: string;
  defaultAlt: string;
};

/**
 * Ask for alternative text before an uploaded image enters the release body.
 *
 * The filename is only a starting point. Requiring a non-empty description here
 * keeps images meaningful for screen-reader users and for anyone whose image
 * fails to load. Decorative images belong outside the release body.
 */
export function InlineImageAltDialog({
  images,
  onCancel,
  onConfirm,
}: {
  images: PendingInlineImage[];
  onCancel: () => void;
  onConfirm: (entries: Array<PendingInlineImage & { alt: string }>) => void;
}) {
  const [alts, setAlts] = useState<Record<string, string>>(() =>
    Object.fromEntries(images.map((image) => [image.key, image.defaultAlt])),
  );

  const complete = images.every((image) => (alts[image.key] ?? "").trim().length > 0);

  return (
    <Dialog
      open={images.length > 0}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Describe the images you added</DialogTitle>
          <DialogDescription id="inline-image-alt-help">
            Alternative text is read by screen readers and shown when an image cannot load.
            Describe what the image shows, not the filename. Edit the suggested text if it is not
            meaningful.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {images.map((image, index) => {
            const inputId = `inline-image-alt-${index}`;
            const value = alts[image.key] ?? "";
            return (
              <div key={image.key} className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-[120px_minmax(0,1fr)]">
                <Image
                  src={image.url}
                  alt=""
                  width={240}
                  height={140}
                  unoptimized
                  sizes="120px"
                  className="h-24 w-full rounded-md border bg-card object-contain"
                />
                <div className="min-w-0 space-y-1.5">
                  <p className="truncate text-xs text-muted-foreground">{image.fileName}</p>
                  <Label htmlFor={inputId}>Alternative text</Label>
                  <Input
                    id={inputId}
                    value={value}
                    onChange={(event) =>
                      setAlts((current) => ({ ...current, [image.key]: event.target.value }))
                    }
                    aria-describedby="inline-image-alt-help"
                    aria-invalid={value.trim().length === 0}
                    maxLength={160}
                    autoFocus={index === 0}
                  />
                  {value.trim().length === 0 ? (
                    <p className="text-xs font-medium text-destructive">
                      Enter a description before inserting this image.
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!complete}
            onClick={() =>
              onConfirm(
                images.map((image) => ({
                  ...image,
                  alt: (alts[image.key] ?? "").trim(),
                })),
              )
            }
          >
            Insert {images.length === 1 ? "image" : `${images.length} images`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
