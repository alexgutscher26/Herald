"use client";

import { Monitor, Moon, Smartphone, Sun } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EmailPreview } from "@/features/email/previews";

/*
 * The templates carry their own `@media (prefers-color-scheme: dark)` block, so
 * an iframe following a dark system preference renders dark even when the
 * preview is set to Light. Each mode therefore appends a style block with the
 * same selectors and `!important`: it comes after the template's media query,
 * so with equal specificity the preview's choice wins either way.
 */
const LIGHT_OVERRIDE = `<style>
  body.email-body, .email-shell { background: #f8fafc !important; }
  .email-card { background: #ffffff !important; border-color: #e2e8f0 !important; }
  .email-eyebrow, .email-footer, .email-link { color: #64748b !important; }
  .email-heading { color: #0f172a !important; }
  .email-text { color: #334155 !important; }
  .email-rule { border-top-color: #e2e8f0 !important; }
  .email-action { background: #0f172a !important; color: #ffffff !important; }
</style>`;

const DARK_OVERRIDE = `<style>
  body.email-body, .email-shell { background: #0b1120 !important; }
  .email-card { background: #111827 !important; border-color: #334155 !important; }
  .email-eyebrow, .email-footer, .email-link { color: #94a3b8 !important; }
  .email-heading { color: #f8fafc !important; }
  .email-text { color: #cbd5e1 !important; }
  .email-rule { border-top-color: #334155 !important; }
  .email-action { background: #f8fafc !important; color: #0f172a !important; }
</style>`;

function withPreviewTheme(html: string, override: string): string {
  return html.includes("</head>")
    ? html.replace("</head>", `${override}</head>`)
    : `${html}${override}`;
}

export function EmailPreviewView({ previews }: { previews: EmailPreview[] }) {
  const [selectedId, setSelectedId] = useState(previews[0]?.id ?? "");
  const [dark, setDark] = useState(false);
  const [mobile, setMobile] = useState(false);
  const selected = previews.find((preview) => preview.id === selectedId) ?? previews[0];

  if (!selected) return null;

  return (
    <Card id="email-previews" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>Email previews</CardTitle>
        <CardDescription>
          Every outbound template rendered with fixed sample data. Links use example URLs and no
          subscriber, customer or delivery row is touched.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid min-w-64 flex-1 gap-1.5">
            <label htmlFor="email-preview-template" className="text-xs font-medium">
              Template
            </label>
            <Select value={selected.id} onValueChange={setSelectedId}>
              <SelectTrigger id="email-preview-template">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {previews.map((preview) => (
                  <SelectItem key={preview.id} value={preview.id}>
                    {preview.category} · {preview.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-1 rounded-md border p-1" role="group" aria-label="Preview color">
            <Button
              type="button"
              size="sm"
              variant={dark ? "ghost" : "secondary"}
              aria-pressed={!dark}
              onClick={() => setDark(false)}
            >
              <Sun aria-hidden="true" />
              Light
            </Button>
            <Button
              type="button"
              size="sm"
              variant={dark ? "secondary" : "ghost"}
              aria-pressed={dark}
              onClick={() => setDark(true)}
            >
              <Moon aria-hidden="true" />
              Dark
            </Button>
          </div>
          <div className="flex gap-1 rounded-md border p-1" role="group" aria-label="Preview width">
            <Button
              type="button"
              size="sm"
              variant={mobile ? "ghost" : "secondary"}
              aria-pressed={!mobile}
              onClick={() => setMobile(false)}
            >
              <Monitor aria-hidden="true" />
              Desktop
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mobile ? "secondary" : "ghost"}
              aria-pressed={mobile}
              onClick={() => setMobile(true)}
            >
              <Smartphone aria-hidden="true" />
              Mobile
            </Button>
          </div>
        </div>

        <div className="rounded-md border bg-muted/20 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Subject</p>
          <p className="mt-1 text-sm font-medium">{selected.subject}</p>
        </div>

        <div className="overflow-x-auto rounded-md border bg-slate-100 p-3 dark:bg-slate-900">
          <iframe
            key={`${selected.id}:${dark ? "dark" : "light"}:${mobile ? "mobile" : "desktop"}`}
            title={`${selected.label} email preview`}
            srcDoc={withPreviewTheme(selected.html, dark ? DARK_OVERRIDE : LIGHT_OVERRIDE)}
            sandbox=""
            referrerPolicy="no-referrer"
            className="mx-auto block h-[560px] rounded-md border bg-white shadow-sm"
            style={{ width: mobile ? 375 : "100%", maxWidth: "100%" }}
          />
        </div>

        <div className="grid gap-2 text-xs leading-relaxed text-muted-foreground sm:grid-cols-3">
          <p>
            <span className="font-medium text-foreground">Dark mode:</span> preview forces the
            color-scheme overrides. The sent template also declares{" "}
            <code>supported-color-schemes</code>.
          </p>
          <p>
            <span className="font-medium text-foreground">Outlook:</span> the envelope is a
            presentational table with an MSO conditional fixed-width wrapper.
          </p>
          <p>
            <span className="font-medium text-foreground">Mobile:</span> at 375 px the card loses
            its side border and padding, and the action button becomes full width.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
