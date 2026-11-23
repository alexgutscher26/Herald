"use client";

import { ImagePlus, Palette, Trash2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { toastActionFailure } from "@/features/billing/action-toast";

import { SettingsSection } from "@/components/shared/settings-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import { saveBrandingAction } from "./actions";
import type { BrandingSettingsView as BrandingView } from "./branding";
import {
  accentContrast,
  isBrandColor,
  MAX_LOGO_BYTES,
  PUBLIC_LOCALE_CHOICES,
  PUBLIC_LOCALE_LABELS,
  PUBLIC_THEMES,
  PUBLIC_THEME_LABELS,
  type PublicLocaleChoice,
  type PublicTheme,
} from "./schema";

/**
 * Public branding.
 *
 * One save covers the logo, name, accent, theme and language. The logo is
 * optional; leaving the picker empty preserves the current one unless Remove
 * is explicit, so saving a colour never silently deletes an image.
 */

const DEFAULT_COLOR = "#4f46e5";
const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm shadow-none transition-colors focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50";

export function BrandingSettingsView({
  workspaceSlug,
  productSlug,
  workspaceName,
  initial,
  logoUrl,
  canManage,
  hideAttributionAllowed,
}: {
  workspaceSlug: string;
  productSlug: string;
  workspaceName: string;
  initial: BrandingView;
  logoUrl: string | null;
  canManage: boolean;
  hideAttributionAllowed: boolean;
}) {
  const router = useRouter();
  const [brandName, setBrandName] = useState(initial.brandName);
  const [primaryColor, setPrimaryColor] = useState(initial.primaryColor);
  const [theme, setTheme] = useState<PublicTheme>(initial.theme);
  const [locale, setLocale] = useState<PublicLocaleChoice>(initial.locale);
  const [logo, setLogo] = useState<File | null>(null);
  // A downgrade leaves the stored flag set even though the entitlement no longer
  // applies. Start from the effective value so a later save does not send a paid
  // feature back to the server and fail with an upgrade error.
  const [hideAttribution, setHideAttribution] = useState(
    hideAttributionAllowed && initial.hideAttribution,
  );
  const [removeLogo, setRemoveLogo] = useState(false);
  const [saving, startSave] = useTransition();

  function save() {
    startSave(async () => {
      const result = await saveBrandingAction({
        workspaceSlug,
        productSlug,
        brandName,
        primaryColor,
        theme,
        locale,
        hideAttribution,
        removeLogo,
        logo,
      });

      if (!result.ok) {
        toastActionFailure(result);
        return;
      }

      setBrandName(result.data.branding.brandName);
      setPrimaryColor(result.data.branding.primaryColor);
      setTheme(result.data.branding.theme);
      setLocale(result.data.branding.locale);
      setHideAttribution(result.data.branding.hideAttribution);
      setLogo(null);
      setRemoveLogo(false);
      router.refresh();
    });
  }

  const showCurrentLogo = logoUrl !== null && !removeLogo && logo === null;
  const normalizedColor = primaryColor.trim().toLowerCase();
  const colorContrast = isBrandColor(normalizedColor) ? accentContrast(normalizedColor) : null;
  const needsAdjustment =
    colorContrast !== null &&
    (colorContrast.light < 4.5 || colorContrast.dark < 4.5);

  return (
    <SettingsSection
      id="branding"
      icon={Palette}
      title="Public branding"
      description="Logo, name, accent colour, theme and language for every public board in this workspace. The dashboard keeps its own theme."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {initial.updatedAt
              ? `Last saved ${new Date(initial.updatedAt).toLocaleString("en")}.`
              : "Not customized yet."}
          </span>
          <Button type="button" onClick={save} disabled={!canManage || saving}>
            {saving ? "Saving…" : "Save branding"}
          </Button>
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Identity
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="brand-name">Public name</Label>
            <Input
              id="brand-name"
              value={brandName}
              onChange={(event) => setBrandName(event.target.value)}
              maxLength={60}
              placeholder={workspaceName}
              disabled={!canManage}
            />
            <p className="text-xs text-muted-foreground">
              Leave blank to use “{workspaceName}”.
            </p>
          </div>

          <div className="rounded-lg border border-border/80 bg-muted/20 p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Logo</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  PNG, JPEG, WebP or GIF, up to 512 KB. Shown beside the public name.
                </p>
              </div>
              <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/80 bg-card">
                {showCurrentLogo ? (
                  <Image
                    src={logoUrl}
                    alt="Current public logo"
                    width={64}
                    height={64}
                    unoptimized
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <ImagePlus className="size-5 text-muted-foreground" aria-hidden="true" />
                )}
              </span>
            </div>

            <input
              id="brand-logo"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              disabled={!canManage}
              onChange={(event) => {
                const selected = event.target.files?.[0] ?? null;
                if (selected && selected.size > MAX_LOGO_BYTES) {
                  toast.error(`Choose a logo under ${Math.round(MAX_LOGO_BYTES / 1024)} KB.`);
                  event.target.value = "";
                  setLogo(null);
                  return;
                }
                setLogo(selected);
                if (selected) setRemoveLogo(false);
              }}
              className="mt-3 block w-full max-w-full text-xs text-muted-foreground file:mr-3 file:rounded-md file:border file:bg-card file:px-2.5 file:py-1.5 file:text-xs file:font-medium"
            />

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {logoUrl && !removeLogo ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setRemoveLogo(true);
                    setLogo(null);
                  }}
                  disabled={!canManage}
                >
                  <Trash2 aria-hidden="true" />
                  Remove logo
                </Button>
              ) : null}
              {removeLogo ? (
                <span className="text-xs text-warning">The logo is removed when you save.</span>
              ) : null}
              {logo ? (
                <span className="text-xs text-muted-foreground">
                  {logo.name} · {Math.round(logo.size / 1024)} KB
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Appearance
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="brand-color">Primary colour</Label>
            <div className="flex items-center gap-2">
              <input
                id="brand-color-picker"
                type="color"
                aria-label="Choose primary colour"
                aria-describedby="brand-color-help brand-color-contrast"
                value={(primaryColor || DEFAULT_COLOR).toLowerCase()}
                onChange={(event) => setPrimaryColor(event.target.value.toLowerCase())}
                disabled={!canManage}
                className="h-9 w-12 cursor-pointer rounded-md border border-input bg-card p-1"
              />
              <Input
                id="brand-color"
                value={primaryColor}
                onChange={(event) => setPrimaryColor(event.target.value)}
                placeholder={DEFAULT_COLOR}
                maxLength={7}
                aria-describedby="brand-color-help brand-color-contrast"
                aria-invalid={primaryColor.trim() !== "" && !isBrandColor(normalizedColor)}
                disabled={!canManage}
              />
              {primaryColor ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setPrimaryColor("")}
                  disabled={!canManage}
                >
                  Reset
                </Button>
              ) : null}
            </div>
            <p id="brand-color-help" className="text-xs text-muted-foreground">
              Six-digit hex. Herald derives an accessible shade for links, focus rings and
              buttons on each public theme.
            </p>
            <p id="brand-color-contrast" className="text-xs text-muted-foreground">
              {colorContrast ? (
                <>
                  Chosen colour contrast: {colorContrast.light.toFixed(1)}:1 on light,{" "}
                  {colorContrast.dark.toFixed(1)}:1 on dark.{" "}
                  {needsAdjustment
                    ? "The public theme uses a lighter or darker shade where 4.5:1 would otherwise fail."
                    : "Meets the 4.5:1 text target on both surfaces."}
                </>
              ) : (
                "Enter a valid colour to see its contrast on the public light and dark surfaces."
              )}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="brand-theme">Theme</Label>
              <select
                id="brand-theme"
                className={SELECT_CLASS}
                value={theme}
                onChange={(event) => setTheme(event.target.value as PublicTheme)}
                disabled={!canManage}
              >
                {PUBLIC_THEMES.map((option) => (
                  <option key={option} value={option}>
                    {PUBLIC_THEME_LABELS[option]}
                  </option>
                ))}
              </select>
              <p className="text-xs leading-5 text-muted-foreground">
                “Follow system” respects the visitor&apos;s preference.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="brand-locale">Language</Label>
              <select
                id="brand-locale"
                className={SELECT_CLASS}
                value={locale}
                onChange={(event) => setLocale(event.target.value as PublicLocaleChoice)}
                disabled={!canManage}
              >
                {PUBLIC_LOCALE_CHOICES.map((option) => (
                  <option key={option} value={option}>
                    {PUBLIC_LOCALE_LABELS[option]}
                  </option>
                ))}
              </select>
              <p className="text-xs leading-5 text-muted-foreground">
                Automatic reads <code>Accept-Language</code>; visitors can still switch.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between gap-4 rounded-lg border border-border/80 bg-muted/20 p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-foreground">Hide “Powered by Herald”</p>
            {hideAttributionAllowed ? null : (
              <Badge variant="outline" className="text-muted-foreground">
                Paid plan
              </Badge>
            )}
          </div>
          <p id="hide-attribution-hint" className="mt-1 text-xs leading-5 text-muted-foreground">
            Removes the small attribution from public pages.{" "}
            {hideAttributionAllowed ? (
              "Indie and Professional plans."
            ) : (
              <>
                Available on the{" "}
                <Link
                  href={`/app/${workspaceSlug}/settings#billing`}
                  className="font-medium text-primary hover:underline"
                >
                  Indie plan
                </Link>{" "}
                and above.
              </>
            )}
          </p>
        </div>
        <Switch
          checked={hideAttributionAllowed && hideAttribution}
          onCheckedChange={setHideAttribution}
          disabled={!canManage || !hideAttributionAllowed}
          aria-label="Hide Herald attribution"
          aria-describedby="hide-attribution-hint"
        />
      </div>
    </SettingsSection>
  );
}
