"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  isThemeMode,
  resolveThemeMode,
  THEME_STORAGE_KEY,
  type ThemeMode,
} from "@/lib/theme";

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readMode(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function writeMode(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // The preference is still applied for this session.
  }
  for (const listener of listeners) listener();
}

function applyTheme(mode: ThemeMode): void {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = resolveThemeMode(mode, prefersDark) === "dark";
  const isDashboard = window.location.pathname === "/app" || window.location.pathname.startsWith("/app/");
  document.documentElement.classList.toggle("dark", dark && isDashboard);
}

/**
 * Light, dark or system for the dashboard only.
 *
 * The choice is stored per browser. Marketing and public pages keep their own
 * palettes; leaving the dashboard removes the `dark` class.
 */
export function ThemeToggle() {
  const mode = useSyncExternalStore<ThemeMode>(subscribe, readMode, () => "system");

  useEffect(() => {
    applyTheme(mode);
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme(mode);
    query.addEventListener("change", onChange);
    return () => {
      query.removeEventListener("change", onChange);
      document.documentElement.classList.remove("dark");
    };
  }, [mode]);

  const label =
    mode === "light" ? "Light" : mode === "dark" ? "Dark" : "System";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Theme: ${label}`}
          title={`Theme: ${label}`}
        >
          {mode === "light" ? (
            <Sun aria-hidden="true" />
          ) : mode === "dark" ? (
            <Moon aria-hidden="true" />
          ) : (
            <Monitor aria-hidden="true" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => writeMode("light")}>
          <Sun aria-hidden="true" />
          Light
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => writeMode("dark")}>
          <Moon aria-hidden="true" />
          Dark
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => writeMode("system")}>
          <Monitor aria-hidden="true" />
          System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
