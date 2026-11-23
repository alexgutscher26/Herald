"use client";

import { usePathname } from "next/navigation";

import { buildSupportHref } from "@/lib/support-link";

const TEXT = "#1c1b19";
const MUTED = "#6b6862";
const BORDER = "#e2ded5";
const PAPER = "#f4f3ee";
const GREEN = "#1f6b45";
const DARK_GREEN = "#175236";

const buttonBase = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  height: 36,
  borderRadius: 6,
  padding: "0 14px",
  fontSize: 14,
  fontWeight: 500,
  lineHeight: 1,
  textDecoration: "none",
} as const;

/**
 * Last-resort error boundary.
 *
 * Replaces the whole document when the root layout itself fails. It must not
 * depend on the app's stylesheet or fonts, so the copy is plain and inline. It
 * still follows the shared error pattern: retry, a prefilled support link and a
 * status link. It never renders the error message, stack trace or request data.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();
  const supportHref = buildSupportHref({ pathname, digest: error.digest });

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: PAPER,
          color: TEXT,
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
          padding: "24px",
        }}
      >
        <main
          style={{
            width: "100%",
            maxWidth: "34rem",
            background: "#ffffff",
            border: `1px solid ${BORDER}`,
            borderRadius: 12,
            boxShadow: "0 1px 2px rgba(23,22,20,0.06), 0 24px 60px -44px rgba(23,22,20,0.55)",
            padding: "40px 28px",
            textAlign: "center",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              color: TEXT,
            }}
          >
            <span
              style={{
                display: "flex",
                width: 26,
                height: 26,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 6,
                background: GREEN,
                color: PAPER,
                fontSize: 13,
                fontWeight: 700,
              }}
              aria-hidden="true"
            >
              H
            </span>
            <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}>Herald</span>
          </span>

          <p
            style={{
              margin: "20px 0 0",
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: MUTED,
            }}
          >
            Error
          </p>
          <h1 style={{ margin: "8px 0 0", fontSize: 24, lineHeight: 1.25, letterSpacing: "-0.02em" }}>
            This page could not be loaded
          </h1>
          <p style={{ margin: "12px auto 0", maxWidth: "26rem", fontSize: 14, lineHeight: 1.6, color: "#4e4a44" }}>
            An unexpected error occurred. Retrying in a few seconds usually works. If the problem
            continues, the live status page has the current state of every dependency.
          </p>

          <div
            style={{
              marginTop: 26,
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <button
              type="button"
              onClick={reset}
              style={{
                ...buttonBase,
                border: `1px solid ${DARK_GREEN}`,
                background: GREEN,
                color: "#ffffff",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Try again
            </button>
            <a
              href={supportHref}
              style={{
                ...buttonBase,
                border: `1px solid ${BORDER}`,
                background: "#ffffff",
                color: TEXT,
              }}
            >
              Contact support
            </a>
            <a
              href="/status"
              style={{
                ...buttonBase,
                border: "1px solid transparent",
                color: TEXT,
              }}
            >
              Service status
            </a>
          </div>

          {error.digest ? (
            <p style={{ margin: "22px 0 0", fontSize: 12, color: MUTED }}>
              Reference:{" "}
              <span
                style={{
                  borderRadius: 4,
                  border: `1px solid ${BORDER}`,
                  background: PAPER,
                  padding: "1px 6px",
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
                  fontSize: 11,
                  color: TEXT,
                }}
              >
                {error.digest}
              </span>
            </p>
          ) : null}

          <p style={{ margin: "10px 0 0", fontSize: 12 }}>
            <a href="/status/incidents" style={{ color: DARK_GREEN, textDecoration: "underline" }}>
              Incident runbook
            </a>
          </p>
        </main>
      </body>
    </html>
  );
}
