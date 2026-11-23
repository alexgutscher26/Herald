import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createExperienceAction,
  deleteExperienceAction,
  previewExperienceAction,
  resetExperienceDismissalsAction,
  setExperienceStatusAction,
  updateExperienceAction,
} from "@/features/engagement/actions";
import {
  experienceScheduleState,
  frequencyLabel,
} from "@/features/engagement/experiences";
import { describeRule } from "@/features/engagement/rules";
import { listExperiences } from "@/features/engagement/service";
import { resolveProductPage } from "@/lib/product-page";

export const metadata = { title: "Tours and banners" };

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm";
const TEXTAREA_CLASS =
  "w-full rounded-md border border-input bg-card p-3 font-mono text-xs leading-5";
const DATE_FORMAT = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function utcValue(date: Date | null): string {
  return date ? date.toISOString().slice(0, 16) : "";
}

function scheduleLabel(experience: {
  scheduleStart: Date | null;
  scheduleEnd: Date | null;
}): string {
  const state = experienceScheduleState(experience);
  if (state === "always") return "Always on";
  if (state === "scheduled" && experience.scheduleStart) {
    return `Starts ${DATE_FORMAT.format(experience.scheduleStart)} UTC`;
  }
  if (state === "ended" && experience.scheduleEnd) {
    return `Ended ${DATE_FORMAT.format(experience.scheduleEnd)} UTC`;
  }
  if (experience.scheduleEnd) {
    return `Live until ${DATE_FORMAT.format(experience.scheduleEnd)} UTC`;
  }
  return experience.scheduleStart
    ? `Live since ${DATE_FORMAT.format(experience.scheduleStart)} UTC`
    : "Live";
}

export default async function ExperiencesPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; productSlug: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
    const status = await searchParams;
  const { workspaceSlug, productSlug, context } = await resolveProductPage(params, "settings:manage");
  const experiences = await listExperiences(context.product.id);
  const hidden = (
    <>
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="productSlug" value={productSlug} />
    </>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tours and banners"
        description="Multi-step tours and pinned banners delivered through the versioned widget loader, with per-step targeting, dismissal memory and translated copy."
      />
      {status.error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {status.error}
        </p>
      ) : null}
      {status.saved ? (
        <p className="rounded-md border border-success/30 bg-success-muted px-3 py-2 text-sm text-success">
          Saved.
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_460px]">
        <Card>
          <CardHeader>
            <CardTitle>Experiences</CardTitle>
            <CardDescription>
              Active experiences are fetched by the embed frame and rendered by the host
              loader outside the iframe.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {experiences.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tours or banners yet.</p>
            ) : (
              experiences.map((experience) => {
                const locales = Object.keys(experience.content ?? {});
                return (
                  <div key={experience.id} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">{experience.name}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {experience.kind} · {experience.status} · {experience.views} views ·{" "}
                          {experience.dismissals} dismissals · {experience.completions} completions
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {scheduleLabel(experience)} · {frequencyLabel(
                            experience.frequencyCap,
                            experience.frequencyWindowDays,
                          )}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {locales.length > 0
                            ? `${locales.map((locale) => locale.toUpperCase()).join(" / ")} · default ${experience.defaultLocale.toUpperCase()}`
                            : "No copy"}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {experience.audience.length === 0
                            ? "Everyone"
                            : experience.audience
                                .slice(0, 3)
                                .map((rule) => describeRule(rule))
                                .join(" · ")}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <form action={setExperienceStatusAction}>
                          {hidden}
                          <input type="hidden" name="experienceId" value={experience.id} />
                          <select
                            name="status"
                            defaultValue={experience.status}
                            className={SELECT_CLASS}
                            aria-label={`Status for ${experience.name}`}
                          >
                            <option value="draft">Draft</option>
                            <option value="active">Active</option>
                            <option value="paused">Paused</option>
                          </select>
                          <Button size="sm" variant="outline" type="submit">
                            Save
                          </Button>
                        </form>
                        <form action={previewExperienceAction}>
                          {hidden}
                          <input type="hidden" name="experienceId" value={experience.id} />
                          <Button size="sm" variant="outline" type="submit">
                            Preview
                          </Button>
                        </form>
                        <form action={resetExperienceDismissalsAction}>
                          {hidden}
                          <input type="hidden" name="experienceId" value={experience.id} />
                          <Button size="sm" variant="outline" type="submit">
                            Reset memory
                          </Button>
                        </form>
                        <form action={deleteExperienceAction}>
                          {hidden}
                          <input type="hidden" name="experienceId" value={experience.id} />
                          <Button size="sm" variant="destructive" type="submit">
                            Delete
                          </Button>
                        </form>
                      </div>
                    </div>

                    <details className="mt-3 rounded-md border bg-muted/30 p-3">
                      <summary className="cursor-pointer text-sm font-medium">
                        Edit settings and copy
                      </summary>
                      <form action={updateExperienceAction} className="mt-3 space-y-3">
                        {hidden}
                        <input type="hidden" name="experienceId" value={experience.id} />
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label htmlFor={`experience-name-${experience.id}`}>Name</Label>
                            <Input
                              id={`experience-name-${experience.id}`}
                              name="name"
                              required
                              maxLength={160}
                              defaultValue={experience.name}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`experience-locale-${experience.id}`}>
                              Default locale
                            </Label>
                            <select
                              id={`experience-locale-${experience.id}`}
                              name="defaultLocale"
                              className={SELECT_CLASS}
                              defaultValue={experience.defaultLocale}
                            >
                              <option value="en">English</option>
                              <option value="es">Spanish</option>
                            </select>
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`experience-content-${experience.id}`}>
                            Content (JSON)
                          </Label>
                          <textarea
                            id={`experience-content-${experience.id}`}
                            name="content"
                            rows={12}
                            className={TEXTAREA_CLASS}
                            defaultValue={JSON.stringify(experience.content, null, 2)}
                          />
                          <p className="text-xs text-muted-foreground">
                            Add an <code>es</code> key for a Spanish variant. Every locale you
                            provide must be complete; the loader does not mix fields between
                            locales. A tour step accepts <code>selector</code>,{" "}
                            <code>pageUrl</code> and its own <code>audience</code>. Page, time,
                            selector and event rules run in the browser; attribute rules are
                            evaluated on the server for each step.
                          </p>
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`experience-audience-${experience.id}`}>
                            Audience rules (JSON)
                          </Label>
                          <textarea
                            id={`experience-audience-${experience.id}`}
                            name="audience"
                            rows={4}
                            className={TEXTAREA_CLASS}
                            defaultValue={JSON.stringify(experience.audience, null, 2)}
                          />
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="space-y-1.5">
                            <Label htmlFor={`experience-dismiss-${experience.id}`}>
                              Dismiss for days
                            </Label>
                            <Input
                              id={`experience-dismiss-${experience.id}`}
                              name="dismissDays"
                              type="number"
                              min={0}
                              max={365}
                              defaultValue={experience.dismissDays}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`experience-cap-${experience.id}`}>
                              Views per window
                            </Label>
                            <Input
                              id={`experience-cap-${experience.id}`}
                              name="frequencyCap"
                              type="number"
                              min={0}
                              max={100}
                              defaultValue={experience.frequencyCap}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`experience-window-${experience.id}`}>
                              Window days
                            </Label>
                            <Input
                              id={`experience-window-${experience.id}`}
                              name="frequencyWindowDays"
                              type="number"
                              min={1}
                              max={365}
                              defaultValue={experience.frequencyWindowDays}
                            />
                          </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label htmlFor={`experience-start-${experience.id}`}>
                              Starts (UTC)
                            </Label>
                            <Input
                              id={`experience-start-${experience.id}`}
                              name="scheduleStart"
                              type="datetime-local"
                              defaultValue={utcValue(experience.scheduleStart)}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`experience-end-${experience.id}`}>
                              Ends (UTC)
                            </Label>
                            <Input
                              id={`experience-end-${experience.id}`}
                              name="scheduleEnd"
                              type="datetime-local"
                              defaultValue={utcValue(experience.scheduleEnd)}
                            />
                          </div>
                        </div>
                        <Button size="sm" type="submit">
                          Save changes
                        </Button>
                      </form>
                    </details>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>New experience</CardTitle>
            <CardDescription>
              Content is keyed by locale. A banner uses title/body; a tour adds steps.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createExperienceAction} className="space-y-3">
              {hidden}
              <div className="space-y-1.5">
                <Label htmlFor="experience-name">Name</Label>
                <Input id="experience-name" name="name" required maxLength={160} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="experience-kind">Type</Label>
                  <select id="experience-kind" name="kind" className={SELECT_CLASS}>
                    <option value="banner">Banner</option>
                    <option value="tour">Tour</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="experience-locale">Default locale</Label>
                  <select id="experience-locale" name="defaultLocale" className={SELECT_CLASS}>
                    <option value="en">English</option>
                    <option value="es">Spanish</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="experience-dismiss">Dismiss days</Label>
                  <Input
                    id="experience-dismiss"
                    name="dismissDays"
                    type="number"
                    min={0}
                    max={365}
                    defaultValue={30}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="experience-cap">Views</Label>
                  <Input
                    id="experience-cap"
                    name="frequencyCap"
                    type="number"
                    min={0}
                    max={100}
                    defaultValue={0}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="experience-window">Days</Label>
                  <Input
                    id="experience-window"
                    name="frequencyWindowDays"
                    type="number"
                    min={1}
                    max={365}
                    defaultValue={7}
                  />
                </div>
              </div>
              <p className="-mt-1 text-xs text-muted-foreground">
                Views 0 means unlimited. Otherwise the banner or tour is shown at most that
                many days per window, counted once per customer and UTC day.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="experience-start">Starts (UTC)</Label>
                  <Input id="experience-start" name="scheduleStart" type="datetime-local" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="experience-end">Ends (UTC)</Label>
                  <Input id="experience-end" name="scheduleEnd" type="datetime-local" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="experience-content">Content (JSON)</Label>
                <textarea
                  id="experience-content"
                  name="content"
                  rows={13}
                  className={TEXTAREA_CLASS}
                  defaultValue={JSON.stringify(
                    {
                      en: {
                        title: "Welcome",
                        body: "Here is what is new.",
                        ctaLabel: "Take the tour",
                        ctaUrl: "/",
                        steps: [
                          {
                            selector: "body",
                            title: "Start here",
                            body: "This is the first step.",
                          },
                        ],
                      },
                    },
                    null,
                    2,
                  )}
                />
                <p className="text-xs text-muted-foreground">
                  Add an <code>es</code> key to translate every field. A step can target a{" "}
                  <code>selector</code>, a <code>pageUrl</code>, or an <code>audience</code>{" "}
                  array. Attribute rules are evaluated on the server per step; page, time,
                  selector and event rules run in the browser.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="experience-audience">Audience rules (JSON, optional)</Label>
                <textarea
                  id="experience-audience"
                  name="audience"
                  rows={4}
                  className={TEXTAREA_CLASS}
                  placeholder='[{"type":"page_url","operator":"contains","value":"/pricing"}]'
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="active" />
                Activate immediately
              </label>
              <Button type="submit" className="w-full">
                Create experience
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
