import Image from "next/image";
import { ImageIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ReleaseCover as ReleaseCoverType } from "@/types";

type ReleaseCoverProps = {
  cover: ReleaseCoverType;
  accentColor: string;
  productInitial?: string;
  className?: string;
};

/**
 * Release cover artwork. Presets are local, tiny inline SVGs (no network
 * requests); an uploaded image is fetched from the storage module through the
 * short-lived signed URL the read path put on the cover.
 */
export function ReleaseCover({
  cover,
  accentColor,
  productInitial = "O",
  className,
}: ReleaseCoverProps) {
  if (cover.kind === "custom" && cover.url) {
    return (
      <div className={cn("relative overflow-hidden rounded-md border bg-muted", className)}>
        <Image
          src={cover.url}
          alt="Custom release cover"
          fill
          unoptimized
          className="object-cover"
          sizes="(max-width: 768px) 100vw, 480px"
        />
      </div>
    );
  }

  if (cover.kind === "none") {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-md border border-dashed bg-muted/60 text-muted-foreground",
          className,
        )}
      >
        <ImageIcon className="size-5" aria-hidden="true" />
      </div>
    );
  }

  const preset = cover.kind === "preset" ? cover.preset : "plain";

  return (
    <div
      aria-hidden="true"
      className={cn("relative overflow-hidden rounded-md border", className)}
      style={{ backgroundColor: `color-mix(in oklab, ${accentColor} 10%, white)` }}
    >
      {preset === "grid" ? (
        <svg className="absolute inset-0 size-full" viewBox="0 0 240 120" preserveAspectRatio="none">
          <defs>
            <pattern id="cover-grid" width="16" height="16" patternUnits="userSpaceOnUse">
              <path d="M 16 0 L 0 0 0 16" fill="none" stroke={accentColor} strokeOpacity="0.16" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="240" height="120" fill="url(#cover-grid)" />
          <circle cx="196" cy="26" r="34" fill={accentColor} fillOpacity="0.16" />
          <path d="M0 104 L92 52 L168 96 L240 60" stroke={accentColor} strokeOpacity="0.55" strokeWidth="2" fill="none" />
        </svg>
      ) : null}

      {preset === "orbit" ? (
        <svg className="absolute inset-0 size-full" viewBox="0 0 240 120" preserveAspectRatio="none">
          <circle cx="78" cy="60" r="46" fill="none" stroke={accentColor} strokeOpacity="0.3" strokeWidth="1.5" />
          <circle cx="78" cy="60" r="29" fill="none" stroke={accentColor} strokeOpacity="0.45" strokeWidth="1.5" />
          <circle cx="78" cy="60" r="12" fill={accentColor} fillOpacity="0.6" />
          <circle cx="78" cy="14" r="4" fill={accentColor} fillOpacity="0.8" />
          <circle cx="122" cy="93" r="3" fill={accentColor} fillOpacity="0.6" />
          <circle cx="196" cy="34" r="26" fill={accentColor} fillOpacity="0.08" />
        </svg>
      ) : null}

      {preset === "waves" ? (
        <svg className="absolute inset-0 size-full" viewBox="0 0 240 120" preserveAspectRatio="none">
          <path d="M0 84 C 40 56, 72 104, 112 78 S 190 44, 240 66 L240 120 L0 120 Z" fill={accentColor} fillOpacity="0.2" />
          <path d="M0 98 C 50 74, 84 116, 128 92 S 198 66, 240 82" stroke={accentColor} strokeOpacity="0.55" strokeWidth="2" fill="none" />
          <path d="M0 66 C 44 42, 80 82, 120 62 S 180 30, 240 46" stroke={accentColor} strokeOpacity="0.25" strokeWidth="1.5" fill="none" />
        </svg>
      ) : null}

      {preset === "plain" ? (
        <span className="absolute inset-0 flex items-center justify-center text-3xl font-semibold tracking-tight" style={{ color: accentColor }}>
          {productInitial}
        </span>
      ) : null}
    </div>
  );
}
