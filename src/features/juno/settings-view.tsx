import { Bot } from "lucide-react";

import { SettingsSection } from "@/components/shared/settings-section";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { JunoSettings } from "@/db/schema/knowledge";

import {
  addKnowledgeUploadAction,
  addKnowledgeUrlAction,
  dismissKnowledgeChangeAction,
  pauseKnowledgeAction,
  recrawlKnowledgeAction,
  removeKnowledgeAction,
  replaceKnowledgeUploadAction,
  resumeKnowledgeAction,
  saveJunoSettingsAction,
  saveKnowledgeSourceSettingsAction,
} from "./actions";
import {
  JUNO_DUPLICATE_MODES,
  JUNO_FORMALITIES,
  JUNO_REPLY_LENGTHS,
  JUNO_TONES,
} from "./settings";
import type { KnowledgeSourceView } from "./sources";
import { JunoDryRunPanel } from "./dry-run-view";

/**
 * Mira settings.
 *
 * Plain forms, one server action per operation, just like the other settings
 * cards. Every action re-checks `juno:manage`; `canManage` only hides input.
 */

const CHECKBOX_CLASS = "size-4 rounded border-input accent-[var(--primary)]";
const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm shadow-none transition-colors focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50";

function statusLabel(source: KnowledgeSourceView): string {
  if (source.latestVersion?.status === "building") return "Updating…";
  if (source.status === "paused") return "Paused";
  if (source.status === "error") return "Needs attention";
  if (source.status === "live") return "Live";
  return "Processing";
}

function sourceStatusTone(source: KnowledgeSourceView): StatusTone {
  if (source.status === "error") return "danger";
  if (source.status === "paused") return "neutral";
  if (source.status === "live" && source.latestVersion?.status !== "building") {
    return "success";
  }
  return "info";
}

export function JunoSettingsView({
  workspaceSlug,
  productSlug,
  settings,
  sources,
  canManage,
}: {
  workspaceSlug: string;
  productSlug: string;
  settings: JunoSettings;
  sources: KnowledgeSourceView[];
  canManage: boolean;
}) {
  const building = sources.some(
    (source) =>
      source.status === "processing" || source.latestVersion?.status === "building",
  );
  const live = sources.filter(
    (source) => source.status === "live" && source.activeVersion,
  ).length;
  const changed = sources.some((source) => source.lastChangeSummary !== null);
  const manualSources = sources.filter(
    (source) => source.kind === "upload" || source.kind === "url",
  );

  return (
    <SettingsSection
      id="juno"
      icon={Bot}
      title="Mira"
      description="Mira answers from the sources below and hands off when the answer is not covered, when someone asks for a human, or for billing and account questions. A human reply takes the thread back until someone presses “Hand to Mira”."
      badge={
        building ? (
          <StatusBadge tone="info">Updating Mira…</StatusBadge>
        ) : changed ? (
          <StatusBadge tone="warning">Source changed</StatusBadge>
        ) : live > 0 ? (
          <StatusBadge tone="success">Knowledge is live</StatusBadge>
        ) : (
          <StatusBadge tone="neutral">No knowledge yet</StatusBadge>
        )
      }
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Knowledge sources
              </h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Uploaded docs and public pages Mira is allowed to cite.
              </p>
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">
              {manualSources.length}/5
            </span>
          </div>

          {sources.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/15 px-4 py-5 text-sm leading-6 text-muted-foreground">
              Nothing yet. Upload a help doc or point Mira at a public docs path.
            </div>
          ) : (
            <ul className="space-y-3">
              {sources.map((source) => (
                <li
                  key={source.id}
                  className="rounded-lg border border-border/80 bg-card p-3.5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="min-w-0 text-sm font-medium text-foreground">
                      {source.name}
                    </p>
                    <StatusBadge tone={sourceStatusTone(source)}>
                      {statusLabel(source)}
                    </StatusBadge>
                  </div>
                  <p className="mt-1 break-all text-xs leading-5 text-muted-foreground">
                    {source.kind === "url"
                      ? `${source.url}${source.pathPrefix && source.pathPrefix !== "/" ? ` (only ${source.pathPrefix})` : ""}`
                      : source.kind === "help_collection"
                        ? "Managed by Help center"
                        : source.kind === "api_docs"
                          ? "Managed by API documentation"
                          : "Uploaded document"}
                    {source.activeVersion
                      ? ` · ${source.activeVersion.pageCount} pages · ${source.activeVersion.chunkCount} chunks`
                      : ""}
                    {source.visibility === "internal" ? " · Internal only" : ""}
                    {source.lastCheckedAt
                      ? ` · checked ${new Date(source.lastCheckedAt).toLocaleDateString()}`
                      : ""}
                  </p>
                  {source.lastError ? (
                    <p className="mt-1 text-xs text-destructive">{source.lastError}</p>
                  ) : null}

                  {source.lastChangeSummary ? (
                    <div className="mt-2 rounded-md border border-warning/30 bg-warning-muted/40 px-3 py-2">
                      <p className="text-xs font-medium text-foreground">Source changed</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {source.lastChangeSummary.added} added ·{" "}
                        {source.lastChangeSummary.removed} removed ·{" "}
                        {source.lastChangeSummary.changed} edited
                        {source.lastChangedAt
                          ? ` · ${new Date(source.lastChangedAt).toLocaleDateString()}`
                          : ""}
                      </p>
                      {canManage ? (
                        <form action={dismissKnowledgeChangeAction} className="mt-1.5">
                          <input
                            type="hidden"
                            name="workspaceSlug"
                            value={workspaceSlug}
                          />
                          <input
                            type="hidden"
                            name="productSlug"
                            value={productSlug}
                          />
                          <input type="hidden" name="sourceId" value={source.id} />
                          <Button type="submit" size="sm" variant="ghost">
                            Dismiss
                          </Button>
                        </form>
                      ) : null}
                    </div>
                  ) : null}

                  {canManage &&
                  source.kind !== "help_collection" &&
                  source.kind !== "api_docs" ? (
                    <form
                      action={saveKnowledgeSourceSettingsAction}
                      className="mt-3 flex flex-wrap items-end gap-2 border-t border-border/70 pt-3"
                    >
                      <input
                        type="hidden"
                        name="workspaceSlug"
                        value={workspaceSlug}
                      />
                      <input
                        type="hidden"
                        name="productSlug"
                        value={productSlug}
                      />
                      <input type="hidden" name="sourceId" value={source.id} />
                      <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
                        Who can use it
                        <select
                          name="visibility"
                          defaultValue={source.visibility}
                          className="h-8 w-64 rounded-md border border-input bg-card px-2 text-xs"
                        >
                          <option value="public">Public — customer answers</option>
                          <option value="internal">Internal only — never widget</option>
                        </select>
                      </label>
                      {source.kind === "url" ? (
                        <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
                          Check every (hours)
                          <input
                            type="number"
                            name="recrawlIntervalHours"
                            min={0}
                            max={720}
                            defaultValue={source.recrawlIntervalHours}
                            className="h-8 w-24 rounded-md border border-input bg-card px-2 text-xs"
                          />
                        </label>
                      ) : null}
                      <Button type="submit" size="sm" variant="outline">
                        Save
                      </Button>
                    </form>
                  ) : null}

                  {canManage ? (
                    <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border/70 pt-3">
                      {source.kind === "url" ? (
                        <form action={recrawlKnowledgeAction}>
                          <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
                          <input type="hidden" name="productSlug" value={productSlug} />
                          <input type="hidden" name="sourceId" value={source.id} />
                          <Button type="submit" size="sm" variant="outline">
                            Recrawl
                          </Button>
                        </form>
                      ) : source.kind === "upload" ? (
                        <form
                          action={replaceKnowledgeUploadAction}
                          className="flex flex-wrap items-center gap-1.5"
                        >
                          <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
                          <input type="hidden" name="productSlug" value={productSlug} />
                          <input type="hidden" name="sourceId" value={source.id} />
                          <input
                            type="file"
                            name="file"
                            accept=".md,.markdown,.txt,.html,.htm,.json,.yaml,.yml,.pdf"
                            className="max-w-40 text-xs text-muted-foreground file:mr-2 file:rounded-md file:border file:bg-card file:px-2 file:py-1 file:text-xs"
                          />
                          <Button type="submit" size="sm" variant="outline">
                            Replace
                          </Button>
                        </form>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Managed automatically. Update it in Help center or API documentation.
                        </p>
                      )}

                      {source.status === "paused" ? (
                        <form action={resumeKnowledgeAction}>
                          <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
                          <input type="hidden" name="productSlug" value={productSlug} />
                          <input type="hidden" name="sourceId" value={source.id} />
                          <Button type="submit" size="sm" variant="outline">
                            Resume
                          </Button>
                        </form>
                      ) : (
                        <form action={pauseKnowledgeAction}>
                          <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
                          <input type="hidden" name="productSlug" value={productSlug} />
                          <input type="hidden" name="sourceId" value={source.id} />
                          <Button type="submit" size="sm" variant="outline">
                            Pause
                          </Button>
                        </form>
                      )}

                      <form action={removeKnowledgeAction} className="ml-auto">
                        <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
                        <input type="hidden" name="productSlug" value={productSlug} />
                        <input type="hidden" name="sourceId" value={source.id} />
                        <Button
                          type="submit"
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:bg-destructive/5 hover:text-destructive"
                        >
                          Remove
                        </Button>
                      </form>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {canManage && manualSources.length < 5 ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/15 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Add a source
              </p>

              <form action={addKnowledgeUploadAction} className="mt-3 space-y-2.5">
                <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
                <input type="hidden" name="productSlug" value={productSlug} />
                <div className="grid gap-1.5">
                  <Label htmlFor="knowledge-upload-name">Source name</Label>
                  <Input
                    id="knowledge-upload-name"
                    name="name"
                    placeholder="Help center"
                    maxLength={80}
                  />
                </div>
                <input
                  type="file"
                  name="file"
                  required
                  accept=".md,.markdown,.txt,.html,.htm,.json,.yaml,.yml,.pdf"
                  className="block w-full text-xs text-muted-foreground file:mr-2 file:rounded-md file:border file:bg-card file:px-2.5 file:py-1.5 file:text-xs file:font-medium"
                />
                <p className="text-xs leading-5 text-muted-foreground">
                  Markdown, plain text, HTML, JSON, YAML or PDF up to 10 MB. A scanned
                  PDF needs OCR first. The new version only replaces the old one after it is
                  fully indexed.
                </p>
                <Button type="submit" size="sm">
                  Upload source
                </Button>
              </form>

              <div className="my-4 border-t border-border/70" />

              <form action={addKnowledgeUrlAction} className="space-y-2.5">
                <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
                <input type="hidden" name="productSlug" value={productSlug} />
                <div className="grid gap-1.5">
                  <Label htmlFor="knowledge-url-name">Source name</Label>
                  <Input
                    id="knowledge-url-name"
                    name="name"
                    placeholder="Public docs"
                    maxLength={80}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="knowledge-url">Public URL</Label>
                  <Input
                    id="knowledge-url"
                    name="url"
                    type="url"
                    required
                    placeholder="https://example.com/docs"
                  />
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  Only public pages on the same origin, beneath that path. Private and
                  loopback addresses are refused.
                </p>
                <Button type="submit" size="sm" variant="outline">
                  Add crawl
                </Button>
              </form>
            </div>
          ) : null}
        </div>

        <form
          action={saveJunoSettingsAction}
          className="h-fit overflow-hidden rounded-lg border border-border/80 bg-muted/15"
        >
          <div className="border-b border-border/70 bg-card px-4 py-3.5">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Behavior
            </h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Tone, limits and handoff thresholds for new conversations.
            </p>
          </div>

          <div className="space-y-4 p-4">
            <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
            <input type="hidden" name="productSlug" value={productSlug} />

            <label className="flex items-start justify-between gap-4 rounded-lg border border-border/80 bg-card p-3.5">
              <span>
                <span className="block text-sm font-medium text-foreground">
                  Let Mira pick up new conversations
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                  Turning this off stops new pickups; threads in progress keep their state.
                </span>
              </span>
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={settings.enabled}
                disabled={!canManage}
                className={CHECKBOX_CLASS}
              />
            </label>

            <div className="grid gap-1.5">
              <Label htmlFor="juno-duplicate-mode">Duplicate linking</Label>
              <select
                id="juno-duplicate-mode"
                name="duplicateMode"
                defaultValue={settings.duplicateMode}
                disabled={!canManage}
                className={SELECT_CLASS}
              >
                {JUNO_DUPLICATE_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode === "off"
                      ? "Off — never check for duplicates"
                      : mode === "assisted"
                        ? "Assisted — queue possible duplicates for review"
                        : "Automatic — merge high-confidence duplicates"}
                  </option>
                ))}
              </select>
              <p className="text-xs leading-5 text-muted-foreground">
                Uncertain matches go to duplicate triage. Automatic merges stay undoable
                from merge history.
              </p>
            </div>

            <label className="flex items-start justify-between gap-4 rounded-lg border border-border/80 bg-card p-3.5">
              <span>
                <span className="block text-sm font-medium text-foreground">
                  Offer a writing assistant on public submissions
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                  Customers can preview an AI rewrite or split their ask into separate
                  drafts. Nothing changes unless they choose to use it.
                </span>
              </span>
              <input
                type="checkbox"
                name="submissionAssistantEnabled"
                defaultChecked={settings.submissionAssistantEnabled}
                disabled={!canManage}
                className={CHECKBOX_CLASS}
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="juno-tone">Tone</Label>
                <select
                  id="juno-tone"
                  name="tone"
                  defaultValue={settings.tone}
                  disabled={!canManage}
                  className={SELECT_CLASS}
                >
                  {JUNO_TONES.map((tone) => (
                    <option key={tone} value={tone}>
                      {tone}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="juno-reply-length">Reply length</Label>
                <select
                  id="juno-reply-length"
                  name="replyLength"
                  defaultValue={settings.replyLength}
                  disabled={!canManage}
                  className={SELECT_CLASS}
                >
                  {JUNO_REPLY_LENGTHS.map((length) => (
                    <option key={length} value={length}>
                      {length}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="juno-formality">Formality</Label>
                <select
                  id="juno-formality"
                  name="formality"
                  defaultValue={settings.formality}
                  disabled={!canManage}
                  className={SELECT_CLASS}
                >
                  {JUNO_FORMALITIES.map((formality) => (
                    <option key={formality} value={formality}>
                      {formality}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="juno-language">Answer language</Label>
                <Input
                  id="juno-language"
                  name="language"
                  defaultValue={settings.language}
                  placeholder="auto, workspace or pt-BR"
                  disabled={!canManage}
                />
                <p className="text-xs leading-5 text-muted-foreground">
                  `workspace` uses the public-site locale and falls back to the
                  customer&apos;s language. Customer text is never translated.
                </p>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="juno-model">Model</Label>
                <Input
                  id="juno-model"
                  name="model"
                  defaultValue={settings.model ?? ""}
                  placeholder="Deployment model"
                  disabled={!canManage}
                />
                <p className="text-xs leading-5 text-muted-foreground">
                  Blank uses AI_MODEL; another value is refused.
                </p>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="juno-confidence">Confidence floor</Label>
                <Input
                  id="juno-confidence"
                  name="confidenceFloor"
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  defaultValue={settings.confidenceFloor}
                  disabled={!canManage}
                />
                <p className="text-xs leading-5 text-muted-foreground">
                  Below this score Mira hands off instead of guessing.
                </p>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="juno-budget">Daily budget (cents)</Label>
                <Input
                  id="juno-budget"
                  name="dailyBudgetCents"
                  type="number"
                  min="0"
                  max="100000"
                  defaultValue={settings.dailyBudgetCents}
                  disabled={!canManage}
                />
                <p className="text-xs leading-5 text-muted-foreground">
                  Over budget hands off; it never degrades silently.
                </p>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="juno-auto-chat">Auto-resolve chat (minutes)</Label>
                <Input
                  id="juno-auto-chat"
                  name="autoResolveChatMinutes"
                  type="number"
                  min="0"
                  max="43200"
                  defaultValue={settings.autoResolveChatMinutes}
                  disabled={!canManage}
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="juno-auto-email">Auto-resolve email (minutes)</Label>
                <Input
                  id="juno-auto-email"
                  name="autoResolveEmailMinutes"
                  type="number"
                  min="0"
                  max="43200"
                  defaultValue={settings.autoResolveEmailMinutes}
                  disabled={!canManage}
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="emoji"
                defaultChecked={settings.emoji}
                disabled={!canManage}
                className={CHECKBOX_CLASS}
              />
              Allow one emoji when it fits
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 bg-card px-4 py-3.5">
            {canManage ? (
              <Button type="submit" size="sm">
                Save Mira settings
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                Your role can read Mira settings but not change them.
              </p>
            )}
            <span className="text-xs text-muted-foreground">
              Applies to new pickups.
            </span>
          </div>
        </form>
      </div>

      {canManage ? (
        <JunoDryRunPanel workspaceSlug={workspaceSlug} productSlug={productSlug} />
      ) : null}
    </SettingsSection>
  );
}
