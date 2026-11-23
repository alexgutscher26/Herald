"use client";

import { Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type SearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  /** Optional id so a keyboard shortcut can focus the field. */
  inputId?: string;
  className?: string;
};

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  label = "Search",
  inputId,
  className,
}: SearchInputProps) {
  return (
    <div className={cn("relative w-full sm:w-80", className)}>
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        id={inputId}
        type="search"
        value={value}
        aria-label={label}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 pl-8 pr-8 app-no-clear"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Clear search"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
