"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";

/**
 * The only browser code inside the widget iframe.
 *
 * It reports unread/presence to the launcher, performs the signed identity
 * handshake and keeps keyboard focus inside the open panel. Identity is posted
 * to the same-origin endpoint from the iframe, so the host page never needs a
 * CORS allowance, a third-party cookie or the SSO token in its own DOM.
 */

const UNREAD_REFRESH_MS = 30_000;

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusableElements(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (element) =>
      element.getAttribute("aria-hidden") !== "true" &&
      element.getClientRects().length > 0,
  );
}

type BridgeProps = {
  hostOrigin: string | null;
  workspaceSlug: string;
  productSlug: string;
  panelPath: string;
  unread: number;
  online: boolean;
  identified: boolean;
  accentColor: string;
  accentForeground: string;
  /** Resolved per-origin launcher overrides. */
  theme: string;
  position: string;
  /** Live preview link; the experiences fetch returns that saved draft only. */
  previewToken: string | null;
};

type HostMessage =
  | {
      source?: string;
      type?: string;
      token?: unknown;
      requestId?: unknown;
      inline?: unknown;
      id?: unknown;
      path?: unknown;
    }
  | null;

function postToParent(
  hostOrigin: string,
  payload: Record<string, unknown>,
): void {
  if (window.parent === window) return;
  window.parent.postMessage(
    { source: "herald-widget", ...payload },
    hostOrigin,
  );
}

export function WidgetFrameBridge({
  hostOrigin,
  workspaceSlug,
  productSlug,
  panelPath,
  unread,
  online,
  identified,
  accentColor,
  accentForeground,
  theme,
  position,
  previewToken,
}: BridgeProps) {
  useEffect(() => {
    const targetOrigin = hostOrigin;
    if (!targetOrigin || window.parent === window) return;

    postToParent(targetOrigin, { type: "route", path: panelPath });
  }, [hostOrigin, panelPath]);

  useEffect(() => {
    const targetOrigin = hostOrigin;
    if (!targetOrigin || window.parent === window) return;
    let cancelled = false;
    const query = new URLSearchParams({ workspaceSlug, productSlug });
    if (previewToken) query.set("preview", previewToken);

    void fetch(`/api/public/widget/experiences?${query.toString()}`, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { items?: unknown } | null) => {
        if (cancelled || !Array.isArray(data?.items)) return;
        postToParent(targetOrigin, { type: "experiences", items: data.items });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [hostOrigin, workspaceSlug, productSlug, previewToken]);

  useEffect(() => {
    const targetOrigin = hostOrigin;
    if (!targetOrigin || window.parent === window) return;

    postToParent(targetOrigin, {
      type: "state",
      unread,
      presence: { online },
      identified,
      accent: accentColor,
      accentFg: accentForeground,
      theme,
      position,
    });
  }, [
    hostOrigin,
    unread,
    online,
    identified,
    accentColor,
    accentForeground,
    theme,
    position,
  ]);

  const refreshRef = useRef<() => void>(() => {});

  /**
   * Keep the launcher's badge honest while the host page stays open.
   *
   * The server-rendered count is only as fresh as the frame's last load, so a
   * changelog published or a reply written after that would never reach the
   * badge. The frame re-reads the session-scoped count and reports a change;
   * a hidden tab leans on the focus/visibility events instead of a faster
   * timer, and the interval stops when the frame unmounts.
   */
  useEffect(() => {
    if (!hostOrigin || window.parent === window) return;
    const targetOrigin: string = hostOrigin;

    let cancelled = false;
    let inFlight = false;
    let knownUnread = unread;

    async function refreshUnread() {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const query = new URLSearchParams({ workspaceSlug, productSlug });
        const response = await fetch(
          `/api/public/notifications/unread?${query.toString()}`,
          {
            credentials: "same-origin",
            cache: "no-store",
            headers: { accept: "application/json" },
          },
        );
        if (!response.ok) return;

        const data = (await response.json().catch(() => null)) as {
          unread?: unknown;
        } | null;
        if (
          cancelled ||
          !data ||
          typeof data.unread !== "number" ||
          !Number.isFinite(data.unread)
        ) {
          return;
        }

        const next = Math.max(0, Math.trunc(data.unread));
        if (next === knownUnread) return;
        knownUnread = next;
        postToParent(targetOrigin, {
          type: "state",
          unread: next,
          presence: { online },
          identified,
          accent: accentColor,
          accentFg: accentForeground,
          theme,
          position,
        });
      } catch {
        // Keep the last known count; the next tick retries.
      } finally {
        inFlight = false;
      }
    }

    refreshRef.current = () => {
      void refreshUnread();
    };

    const timer = window.setInterval(() => {
      void refreshUnread();
    }, UNREAD_REFRESH_MS);

    function onVisible() {
      if (document.visibilityState === "visible") void refreshUnread();
    }

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    void refreshUnread();

    return () => {
      cancelled = true;
      refreshRef.current = () => {};
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [
    hostOrigin,
    workspaceSlug,
    productSlug,
    unread,
    online,
    identified,
    accentColor,
    accentForeground,
    theme,
    position,
  ]);

  /**
   * Tell the launcher when the frame has no usable cookie jar. A browser that
   * blocks third-party cookies still loads this document, but every session
   * read is anonymous; the host should explain that instead of showing an
   * empty panel that looks broken.
   */
  useEffect(() => {
    if (!hostOrigin || window.parent === window) return;
    let blocked = navigator.cookieEnabled === false;
    if (!blocked) {
      try {
        const probe = "herald_cookie_probe";
        document.cookie = `${probe}=1; path=/; SameSite=Lax`;
        blocked = !document.cookie.includes(probe);
        if (!blocked) {
          document.cookie = `${probe}=; Max-Age=0; path=/; SameSite=Lax`;
        }
      } catch {
        blocked = true;
      }
    }
    if (blocked) {
      postToParent(hostOrigin, { type: "degraded", reason: "cookies" });
    }
  }, [hostOrigin]);

  const containedRef = useRef(false);

  useEffect(() => {
    if (!hostOrigin || window.parent === window) return;
    const targetOrigin: string = hostOrigin;

    function onMessage(event: MessageEvent<HostMessage>) {
      if (event.origin !== targetOrigin) return;
      if (event.data?.source !== "herald-widget-host") return;

      if (event.data.type === "mode") {
        // Floating panels contain focus; inline embeds are part of the page.
        containedRef.current = event.data.inline !== true;
        return;
      }

      if (event.data.type === "refresh") {
        // The launcher was just opened; do not make it wait for the poll.
        refreshRef.current();
        return;
      }

      if (
        event.data.type === "track" ||
        event.data.type === "survey-impression"
      ) {
        const path = typeof event.data.path === "string" ? event.data.path : "";
        if (
          !path.startsWith("/api/public/surveys/") &&
          !/^\/api\/public\/widget\/experiences\/[0-9a-f-]{36}\/view$/.test(path)
        ) {
          return;
        }
        void fetch(path, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workspaceSlug, productSlug }),
        }).catch(() => undefined);
        return;
      }

      if (
        event.data.type === "experience-dismissed" ||
        event.data.type === "experience-completed"
      ) {
        const id = typeof event.data.id === "string" ? event.data.id : "";
        if (!id) return;
        const action =
          event.data.type === "experience-completed" ? "complete" : "dismiss";
        void fetch(
          `/api/public/widget/experiences/${encodeURIComponent(id)}/${action}`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ workspaceSlug, productSlug }),
          },
        ).catch(() => undefined);
        return;
      }

      if (event.data.type === "identify") {
        const token = typeof event.data.token === "string" ? event.data.token : "";
        const requestId =
          typeof event.data.requestId === "string" ? event.data.requestId : "";

        if (token.length === 0 || token.length > 8192) {
          postToParent(targetOrigin, {
            type: "identify",
            requestId,
            ok: false,
            error: "That identity token is not valid.",
          });
          return;
        }

        void (async () => {
          try {
            const response = await fetch("/api/widget/identify", {
              method: "POST",
              credentials: "include",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ workspaceSlug, token }),
            });
            const data = (await response.json().catch(() => ({}))) as {
              error?: unknown;
            };

            if (!response.ok) {
              postToParent(targetOrigin, {
                type: "identify",
                requestId,
                ok: false,
                error:
                  typeof data.error === "string"
                    ? data.error
                    : "That identity token is not valid.",
              });
              return;
            }

            postToParent(targetOrigin, {
              type: "identify",
              requestId,
              ok: true,
            });
            // Reload after the acknowledgement so the panel reflects the new
            // customer session (name, unread and notification access).
            window.setTimeout(() => window.location.reload(), 50);
          } catch {
            postToParent(targetOrigin, {
              type: "identify",
              requestId,
              ok: false,
              error: "Could not reach the identity service.",
            });
          }
        })();
        return;
      }

      if (event.data.type === "logout") {
        const requestId =
          typeof event.data.requestId === "string" ? event.data.requestId : "";

        void (async () => {
          try {
            const response = await fetch("/api/public/session/logout", {
              method: "POST",
              credentials: "include",
            });
            const data = (await response.json().catch(() => ({}))) as {
              error?: unknown;
            };

            if (!response.ok) {
              postToParent(targetOrigin, {
                type: "logout",
                requestId,
                ok: false,
                error:
                  typeof data.error === "string"
                    ? data.error
                    : "Could not sign out.",
              });
              return;
            }

            postToParent(targetOrigin, {
              type: "logout",
              requestId,
              ok: true,
            });
            window.setTimeout(() => window.location.reload(), 50);
          } catch {
            postToParent(targetOrigin, {
              type: "logout",
              requestId,
              ok: false,
              error: "Could not reach the session service.",
            });
          }
        })();
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        postToParent(targetOrigin, { type: "close" });
        return;
      }

      // Focus containment: the panel is a dialog, so Tab cycles through the
      // panel instead of wandering onto the page behind it. The host page has
      // the matching backstop for focus that lands outside the frame. An
      // inline embed stays in the page's own reading order.
      if (!containedRef.current) return;
      if (event.key !== "Tab" || event.defaultPrevented) return;
      // A panel that opens its own modal dialog already owns the trap.
      if (document.querySelector('[aria-modal="true"]')) return;

      const focusable = focusableElements();
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first || active === document.body || active === null) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (active === last || active === document.body || active === null) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("message", onMessage);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [hostOrigin, workspaceSlug, productSlug]);

  return null;
}

export function WidgetCloseButton({
  hostOrigin,
  label,
}: {
  hostOrigin: string | null;
  label: string;
}) {
  if (!hostOrigin) return null;
  const target = hostOrigin;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-8 shrink-0 transition-all duration-200 hover:rotate-90 active:scale-90"
      aria-label={label}
      title={label}
      onClick={() => postToParent(target, { type: "close" })}
    >
      <X aria-hidden="true" />
    </Button>
  );
}
