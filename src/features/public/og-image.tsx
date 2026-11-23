import { ImageResponse } from "next/og";

/**
 * Open Graph card for the public surface.
 *
 * The image is rendered on demand from the same resolved records as the page,
 * so a shared link never advertises an archived board or a hidden request.
 * Layout is inline styles because Tailwind is not available inside Satori.
 */

export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;

const ACCENT = "#4f46e5";

function clip(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function safeAccent(value: string | null): string {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : ACCENT;
}

export function publicOgImage({
  eyebrow,
  title,
  description,
  footer,
  accent,
}: {
  eyebrow: string;
  title: string;
  description: string;
  footer: string;
  accent: string | null;
}) {
  const color = safeAccent(accent);

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          backgroundColor: "#0b0d12",
          color: "#f8fafc",
          padding: "64px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div
            style={{
              display: "flex",
              width: "16px",
              height: "16px",
              borderRadius: "4px",
              backgroundColor: color,
            }}
          />
          <div
            style={{
              display: "flex",
              fontSize: "26px",
              letterSpacing: "0.1em",
              color: "#a5b4fc",
            }}
          >
            {clip(eyebrow, 70)}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "24px",
            marginTop: "auto",
            marginBottom: "auto",
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: "68px",
              fontWeight: 700,
              lineHeight: 1.08,
            }}
          >
            {clip(title, 88)}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: "30px",
              lineHeight: 1.35,
              color: "#cbd5e1",
            }}
          >
            {clip(description, 150)}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: "1px solid rgba(148, 163, 184, 0.35)",
            paddingTop: "26px",
            fontSize: "24px",
            color: "#94a3b8",
          }}
        >
          <div style={{ display: "flex" }}>{clip(footer, 80)}</div>
          <div style={{ display: "flex", color: "#c7d2fe" }}>Herald</div>
        </div>
      </div>
    ),
    OG_IMAGE_SIZE,
  );
}
