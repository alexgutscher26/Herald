"use client";

import { useSyncExternalStore } from "react";

/**
 * Per-browser list preferences: density, column visibility and column widths.
 *
 * These are view preferences, not tenant data, so they stay in localStorage.
 * The store is cached in a module map so `useSyncExternalStore` returns the
 * same reference between renders and does not loop.
 */

export type Density = "comfortable" | "compact";

export type ColumnDefinition = {
  id: string;
  label: string;
  defaultWidth: number;
  minWidth: number;
  defaultVisible: boolean;
  /** A required column cannot be hidden. */
  required?: boolean;
};

export type ColumnPreference = {
  visible: Record<string, boolean>;
  widths: Record<string, number>;
};

const listeners = new Set<() => void>();
const cache = new Map<string, unknown>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || cache.has(event.key)) {
      cache.delete(event.key ?? "");
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function readValue<T>(key: string, fallback: T): T {
  if (cache.has(key)) return cache.get(key) as T;
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw === null ? fallback : (JSON.parse(raw) as T);
    cache.set(key, parsed);
    return parsed;
  } catch {
    cache.set(key, fallback);
    return fallback;
  }
}

function writeValue<T>(key: string, value: T): void {
  cache.set(key, value);
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A full or disabled storage still keeps the in-memory preference.
  }
  emit();
}

function updateValue<T>(key: string, fallback: T, update: (current: T) => T): void {
  writeValue(key, update(readValue(key, fallback)));
}

export function usePersistentPreference<T>(key: string, fallback: T): T {
  return useSyncExternalStore(
    subscribe,
    () => readValue(key, fallback),
    () => fallback,
  );
}

export function setPersistentPreference<T>(key: string, value: T): void {
  writeValue(key, value);
}

export function densityKey(surface: string): string {
  return `herald:density:${surface}`;
}

export function useDensity(surface: string): [Density, (density: Density) => void] {
  const key = densityKey(surface);
  const density = usePersistentPreference<Density>(key, "comfortable");
  return [density, (next) => setPersistentPreference(key, next)];
}

export function columnKey(surface: string): string {
  return `herald:columns:${surface}`;
}

const EMPTY_COLUMNS: ColumnPreference = { visible: {}, widths: {} };

export function useColumnLayout(
  surface: string,
  columns: readonly ColumnDefinition[],
): {
  isVisible: (id: string) => boolean;
  widthOf: (id: string) => number;
  setVisible: (id: string, visible: boolean) => void;
  setWidth: (id: string, width: number) => void;
  reset: () => void;
} {
  const key = columnKey(surface);
  const stored = usePersistentPreference<ColumnPreference>(key, EMPTY_COLUMNS);

  function column(id: string): ColumnDefinition | undefined {
    return columns.find((candidate) => candidate.id === id);
  }

  return {
    isVisible: (id) => {
      const definition = column(id);
      if (!definition) return false;
      return stored.visible[id] ?? definition.defaultVisible;
    },
    widthOf: (id) => {
      const definition = column(id);
      if (!definition) return 0;
      const width = stored.widths[id];
      return typeof width === "number" && Number.isFinite(width)
        ? Math.max(definition.minWidth, width)
        : definition.defaultWidth;
    },
    setVisible: (id, visible) => {
      const definition = column(id);
      if (!definition || definition.required) return;
      updateValue<ColumnPreference>(key, EMPTY_COLUMNS, (current) => ({
        ...current,
        visible: { ...current.visible, [id]: visible },
      }));
    },
    setWidth: (id, width) => {
      const definition = column(id);
      if (!definition) return;
      updateValue<ColumnPreference>(key, EMPTY_COLUMNS, (current) => ({
        ...current,
        widths: {
          ...current.widths,
          [id]: Math.max(definition.minWidth, Math.round(width)),
        },
      }));
    },
    reset: () => updateValue<ColumnPreference>(key, EMPTY_COLUMNS, () => EMPTY_COLUMNS),
  };
}
