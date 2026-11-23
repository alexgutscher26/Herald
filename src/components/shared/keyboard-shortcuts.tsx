"use client";

import { Keyboard } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type KeyboardShortcut = {
  /** How the key combination is written, for example `g then f`. */
  keys: string;
  action: string;
};

const GLOBAL_SHORTCUTS: KeyboardShortcut[] = [
  { keys: "?", action: "Open or close this shortcut list" },
  { keys: "⌘K / Ctrl K", action: "Open search and navigation" },
  { keys: "g then o", action: "Go to Overview" },
  { keys: "g then f", action: "Go to Feedback" },
  { keys: "g then c", action: "Go to the Inbox" },
  { keys: "g then r", action: "Go to Releases" },
  { keys: "g then s", action: "Go to Settings" },
  { keys: "Esc", action: "Close this shortcut list" },
];

const GO_TO: Record<string, string> = {
  o: "",
  f: "/feedback",
  c: "/conversations",
  r: "/releases",
  s: "/settings",
};

const GO_TO_WINDOW_MS = 1_200;

type ShortcutContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  register: (shortcuts: KeyboardShortcut[]) => () => void;
};

const ShortcutContext = createContext<ShortcutContextValue | null>(null);

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/**
 * Shortcut help for the whole dashboard, and a registry for page-specific keys.
 *
 * The provider owns `?` and the `g` navigation sequences. A page registers its
 * own list with `usePageShortcuts`; its key handler stays in the page because
 * only the page knows what the keys act on.
 */
export function ShortcutProvider({ base, children }: { base: string; children: ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pageShortcutGroups, setPageShortcutGroups] = useState<KeyboardShortcut[][]>([]);

  const register = useCallback((shortcuts: KeyboardShortcut[]) => {
    setPageShortcutGroups((current) =>
      current.includes(shortcuts) ? current : [...current, shortcuts],
    );
    return () => {
      setPageShortcutGroups((current) => current.filter((item) => item !== shortcuts));
    };
  }, []);

  useEffect(() => {
    let lastG = 0;

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      if (event.key === "?") {
        event.preventDefault();
        setOpen((current) => !current);
        return;
      }
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (open) return;

      if (event.key === "g") {
        lastG = Date.now();
        return;
      }

      const destination = GO_TO[event.key];
      if (destination !== undefined && Date.now() - lastG < GO_TO_WINDOW_MS) {
        event.preventDefault();
        lastG = 0;
        router.push(`${base}${destination}`);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [base, open, router]);

  const value = useMemo(
    () => ({ open, setOpen, register }),
    [open, register],
  );

  const shortcuts = [...pageShortcutGroups.flat(), ...GLOBAL_SHORTCUTS];

  return (
    <ShortcutContext.Provider value={value}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>
              Shortcuts work when you are not typing in a field. Press `?` anywhere in the
              dashboard to reopen this list.
            </DialogDescription>
          </DialogHeader>
          <dl className="grid gap-2">
            {shortcuts.map((shortcut) => (
              <div
                key={`${shortcut.keys}:${shortcut.action}`}
                className="flex items-center justify-between gap-4 rounded-md border bg-muted/20 px-3 py-2"
              >
                <dt>
                  <kbd className="rounded border bg-background px-1.5 py-0.5 font-sans text-xs">
                    {shortcut.keys}
                  </kbd>
                </dt>
                <dd className="text-right text-xs text-muted-foreground">{shortcut.action}</dd>
              </div>
            ))}
          </dl>
          <DialogFooter>
            <Button type="button" onClick={() => setOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ShortcutContext.Provider>
  );
}

export function useShortcuts(): ShortcutContextValue {
  const context = useContext(ShortcutContext);
  if (!context) {
    throw new Error("useShortcuts must be used inside ShortcutProvider.");
  }
  return context;
}

/** Register a page's shortcuts for the shared help list. */
export function usePageShortcuts(shortcuts: KeyboardShortcut[]): void {
  const { register } = useShortcuts();

  useEffect(() => register(shortcuts), [register, shortcuts]);
}

/** Header button that opens the same list as `?`. */
export function ShortcutHelpButton() {
  const { setOpen } = useShortcuts();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Keyboard shortcuts (?)"
      title="Keyboard shortcuts (?)"
      onClick={() => setOpen(true)}
    >
      <Keyboard aria-hidden="true" />
    </Button>
  );
}
