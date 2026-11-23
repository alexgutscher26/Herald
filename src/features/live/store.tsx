"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { Toaster } from "sonner";

import type { DashboardState } from "@/types";

/**
 * Snapshot store for the dashboard shell.
 *
 * The server layout loads the snapshot on every request and after each server
 * action, so this provider holds no local copy of the data and performs no
 * persistence. Everything rendered inside it is the database's answer.
 */

type DashboardStoreValue = {
  state: DashboardState;
};

const DashboardContext = createContext<DashboardStoreValue | null>(null);

export function DashboardProvider({
  children,
  initialState,
}: {
  children: ReactNode;
  initialState: DashboardState;
}) {
  const value = useMemo<DashboardStoreValue>(() => ({ state: initialState }), [initialState]);

  return (
    <DashboardContext.Provider value={value}>
      {children}
      <Toaster
        position="bottom-right"
        closeButton
        toastOptions={{
          className: "border bg-background text-foreground shadow-lg",
        }}
      />
    </DashboardContext.Provider>
  );
}

export function useDashboard(): DashboardStoreValue {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error("useDashboard must be used inside DashboardProvider.");
  }
  return context;
}

export { DashboardContext };
