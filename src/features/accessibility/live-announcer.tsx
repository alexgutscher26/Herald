"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type Politeness = "polite" | "assertive";

type LiveAnnouncerValue = {
  announce: (message: string, politeness?: Politeness) => void;
};

const LiveAnnouncerContext = createContext<LiveAnnouncerValue | null>(null);

/**
 * App-wide screen-reader announcements.
 *
 * Toasts are useful visually but are easy to miss with a screen reader. This
 * provider gives asynchronous updates an explicit live region, and lets a page
 * announce an outcome without adding another visible status block. The regions
 * are rendered once, so changing their text is what triggers the announcement.
 */
export function LiveAnnouncerProvider({ children }: { children: ReactNode }) {
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");
  const frame = useRef<number | null>(null);

  const announce = useCallback((message: string, politeness: Politeness = "polite") => {
    const text = message.trim();
    if (text === "") return;

    if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    // Clearing first makes a repeated message announce again.
    if (politeness === "assertive") {
      setAssertive("");
      frame.current = window.requestAnimationFrame(() => setAssertive(text));
    } else {
      setPolite("");
      frame.current = window.requestAnimationFrame(() => setPolite(text));
    }
  }, []);

  const value = useMemo<LiveAnnouncerValue>(() => ({ announce }), [announce]);

  return (
    <LiveAnnouncerContext.Provider value={value}>
      {children}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {polite}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">
        {assertive}
      </div>
    </LiveAnnouncerContext.Provider>
  );
}

export function useAnnounce(): LiveAnnouncerValue["announce"] {
  const context = useContext(LiveAnnouncerContext);
  if (!context) {
    throw new Error("useAnnounce must be used inside LiveAnnouncerProvider.");
  }
  return context.announce;
}
