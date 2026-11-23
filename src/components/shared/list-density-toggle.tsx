"use client";

import { Check, Rows3 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDensity } from "@/lib/list-preferences";

/**
 * Comfortable or compact rows for a list surface.
 *
 * The choice is per surface and per browser; both lists read the same store,
 * so two tabs stay consistent through the `storage` event.
 */
export function ListDensityToggle({ surface, label }: { surface: string; label: string }) {
  const [density, setDensity] = useDensity(surface);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`${label} density: ${density}`}
          title={`${label} density: ${density}`}
        >
          <Rows3 aria-hidden="true" />
          <span className="hidden sm:inline">
            {density === "compact" ? "Compact" : "Comfortable"}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>Row density</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => setDensity("comfortable")}>
          <span className="flex size-4 items-center justify-center">
            {density === "comfortable" ? <Check aria-hidden="true" /> : null}
          </span>
          Comfortable
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setDensity("compact")}>
          <span className="flex size-4 items-center justify-center">
            {density === "compact" ? <Check aria-hidden="true" /> : null}
          </span>
          Compact
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
