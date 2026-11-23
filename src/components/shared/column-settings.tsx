"use client";

import { Check, Columns3, RotateCcw } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ColumnDefinition } from "@/lib/list-preferences";

/**
 * Column visibility menu shared by the release and subscriber tables.
 *
 * Widths are changed by dragging the separator at a header's trailing edge;
 * both visibility and widths persist in localStorage.
 */
export function ColumnSettings({
  columns,
  isVisible,
  onToggle,
  onReset,
}: {
  columns: readonly ColumnDefinition[];
  isVisible: (id: string) => boolean;
  onToggle: (id: string, visible: boolean) => void;
  onReset: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Columns3 aria-hidden="true" />
          <span className="hidden sm:inline">Columns</span>
          <span className="sr-only sm:hidden">Columns</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
        {columns.map((column) => {
          const visible = isVisible(column.id);
          return (
            <DropdownMenuItem
              key={column.id}
              disabled={column.required}
              onSelect={() => {
                if (!column.required) onToggle(column.id, !visible);
              }}
            >
              <span className="flex size-4 items-center justify-center">
                {visible ? <Check aria-hidden="true" /> : null}
              </span>
              <span className="flex-1">{column.label}</span>
              {column.required ? (
                <span className="text-[10px] text-muted-foreground">Required</span>
              ) : null}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onReset}>
          <RotateCcw aria-hidden="true" />
          Reset columns
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ColumnResizer({
  label,
  width,
  minWidth,
  onChange,
}: {
  label: string;
  width: number;
  minWidth: number;
  onChange: (width: number) => void;
}) {
  function startResize(event: ReactPointerEvent<HTMLSpanElement>) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = width;

    const move = (moveEvent: PointerEvent) => {
      onChange(Math.max(minWidth, startWidth + moveEvent.clientX - startX));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }

  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label} column`}
      tabIndex={0}
      onPointerDown={startResize}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          onChange(Math.max(minWidth, width - 16));
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          onChange(width + 16);
        }
      }}
      className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize touch-none rounded-full hover:bg-primary/40 focus-visible:bg-primary/40"
    />
  );
}
