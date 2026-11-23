"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { usePublicI18n } from "@/features/public/i18n/provider";
import type { TopicPreferenceView } from "@/features/subscribers/topics";
import type { DigestFrequency } from "@/features/subscribers/digest-frequency";

export function EmailPreferencesForm({
  token,
  productName,
  workspaceName,
  initial,
}: {
  token: string;
  productName: string;
  workspaceName: string;
  initial: {
    topics: TopicPreferenceView[];
    notifyStatusChanges: boolean;
    notifyReplies: boolean;
    digestFrequency: DigestFrequency;
    quietHours: { start: string; end: string; timezone: string } | null;
  };
}) {
  const { t } = usePublicI18n();
  const [topics, setTopics] = useState(initial.topics);
  const [notifyStatusChanges, setNotifyStatusChanges] = useState(
    initial.notifyStatusChanges,
  );
  const [notifyReplies, setNotifyReplies] = useState(initial.notifyReplies);
  const [digestFrequency, setDigestFrequency] = useState<DigestFrequency>(
    initial.digestFrequency,
  );
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(
    initial.quietHours !== null,
  );
  const [quietStart, setQuietStart] = useState(initial.quietHours?.start ?? "22:00");
  const [quietEnd, setQuietEnd] = useState(initial.quietHours?.end ?? "07:00");
  const [quietTimezone, setQuietTimezone] = useState(
    initial.quietHours?.timezone ?? "UTC",
  );
  const [saving, startSave] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const productUpdates =
    topics.find((topic) => topic.key === "product_updates")?.subscribed ?? false;
  const winback = topics.find((topic) => topic.key === "winback")?.subscribed ?? false;

  function toggleTopic(key: string, subscribed: boolean): void {
    setTopics((current) =>
      current.map((topic) => (topic.key === key ? { ...topic, subscribed } : topic)),
    );
  }

  function save() {
    startSave(async () => {
      setMessage(null);
      setError(null);

      try {
        const response = await fetch("/api/public/email-preferences", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            token,
            productUpdates,
            winback,
            topics: Object.fromEntries(topics.map((topic) => [topic.key, topic.subscribed])),
            notifyStatusChanges,
            notifyReplies,
            digestFrequency,
            quietHours: quietHoursEnabled
              ? {
                  start: quietStart,
                  end: quietEnd,
                  timezone: quietTimezone,
                }
              : null,
          }),
        });
        const payload = (await response.json().catch(() => null)) as
          | {
              preferences?: {
                topics: TopicPreferenceView[];
                notifyStatusChanges: boolean;
                notifyReplies: boolean;
                digestFrequency: DigestFrequency;
                quietHours: { start: string; end: string; timezone: string } | null;
              };
              error?: string;
            }
          | null;

        if (!response.ok || !payload?.preferences) {
          setError(payload?.error ?? t("preferences.saveError"));
          return;
        }

        setTopics(payload.preferences.topics);
        setNotifyStatusChanges(payload.preferences.notifyStatusChanges);
        setNotifyReplies(payload.preferences.notifyReplies);
        setDigestFrequency(payload.preferences.digestFrequency);
        setQuietHoursEnabled(payload.preferences.quietHours !== null);
        if (payload.preferences.quietHours) {
          setQuietStart(payload.preferences.quietHours.start);
          setQuietEnd(payload.preferences.quietHours.end);
          setQuietTimezone(payload.preferences.quietHours.timezone);
        }
        setMessage(t("preferences.saved"));
      } catch {
        setError(t("preferences.networkError"));
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("preferences.emailLists")}
        </h2>
        {topics.map((topic) => {
          const builtIn = topic.key === "product_updates" || topic.key === "winback";
          const label =
            topic.key === "product_updates"
              ? t("preferences.productUpdates", { product: productName })
              : topic.key === "winback"
                ? t("preferences.winback")
                : topic.name;
          const body =
            topic.key === "product_updates"
              ? t("preferences.productUpdatesBody", { workspace: workspaceName })
              : topic.key === "winback"
                ? t("preferences.winbackBody")
                : topic.description || t("preferences.customTopicBody");

          return (
            <div
              key={topic.key}
              className="flex items-start justify-between gap-4 rounded-md border p-3"
            >
              <div className="space-y-1">
                <Label htmlFor={`topic-${topic.key}`} className="text-sm font-medium">
                  {label}
                </Label>
                <p className="text-xs leading-relaxed text-muted-foreground">{body}</p>
                {builtIn || topic.tag ? null : (
                  <p className="text-[11px] text-muted-foreground">
                    {t("preferences.topicKey", { key: topic.key })}
                  </p>
                )}
              </div>
              <input
                id={`topic-${topic.key}`}
                type="checkbox"
                role="switch"
                aria-checked={topic.subscribed}
                checked={topic.subscribed}
                onChange={(event) => toggleTopic(topic.key, event.target.checked)}
                disabled={saving}
                className="mt-1 size-5 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
            </div>
          );
        })}
      </div>

      <div className="space-y-3 border-t pt-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("preferences.requestNotifications")}
        </h2>

        <div className="flex items-start justify-between gap-4 rounded-md border p-3">
          <div className="space-y-1">
            <Label htmlFor="status-changes" className="text-sm font-medium">
              {t("preferences.statusChanges")}
            </Label>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("preferences.statusChangesBody")}
            </p>
          </div>
          <Switch
            id="status-changes"
            checked={notifyStatusChanges}
            onCheckedChange={setNotifyStatusChanges}
            disabled={saving}
          />
        </div>

        <div className="flex items-start justify-between gap-4 rounded-md border p-3">
          <div className="space-y-1">
            <Label htmlFor="replies" className="text-sm font-medium">
              {t("preferences.replies")}
            </Label>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("preferences.repliesBody")}
            </p>
          </div>
          <Switch
            id="replies"
            checked={notifyReplies}
            onCheckedChange={setNotifyReplies}
            disabled={saving}
          />
        </div>

        <div className="flex flex-wrap items-start justify-between gap-4 rounded-md border p-3">
          <div className="space-y-1">
            <Label htmlFor="digest-frequency" className="text-sm font-medium">
              {t("preferences.digestFrequency")}
            </Label>
            <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
              {t("preferences.digestBody")}
            </p>
          </div>
          <Select
            value={productUpdates ? digestFrequency : "off"}
            onValueChange={(value) => setDigestFrequency(value as DigestFrequency)}
            disabled={saving || !productUpdates}
          >
            <SelectTrigger id="digest-frequency" className="w-32" aria-label={t("preferences.digestFrequency")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">{t("preferences.digestOff")}</SelectItem>
              <SelectItem value="daily">{t("preferences.digestDaily")}</SelectItem>
              <SelectItem value="weekly">{t("preferences.digestWeekly")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-3 border-t pt-4">
        <div className="flex items-start justify-between gap-4 rounded-md border p-3">
          <div className="space-y-1">
            <Label htmlFor="quiet-hours" className="text-sm font-medium">
              {t("preferences.quietHours")}
            </Label>
            <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
              {t("preferences.quietHoursBody")}
            </p>
          </div>
          <Switch
            id="quiet-hours"
            checked={quietHoursEnabled}
            onCheckedChange={setQuietHoursEnabled}
            disabled={saving}
          />
        </div>

        {quietHoursEnabled ? (
          <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="quiet-start" className="text-xs font-medium">
                {t("preferences.quietHoursStart")}
              </Label>
              <Input
                id="quiet-start"
                type="time"
                value={quietStart}
                onChange={(event) => setQuietStart(event.target.value)}
                disabled={saving}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quiet-end" className="text-xs font-medium">
                {t("preferences.quietHoursEnd")}
              </Label>
              <Input
                id="quiet-end"
                type="time"
                value={quietEnd}
                onChange={(event) => setQuietEnd(event.target.value)}
                disabled={saving}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quiet-timezone" className="text-xs font-medium">
                {t("preferences.quietHoursTimezone")}
              </Label>
              <Input
                id="quiet-timezone"
                value={quietTimezone}
                onChange={(event) => setQuietTimezone(event.target.value)}
                placeholder="Europe/Madrid"
                disabled={saving}
                required
                maxLength={64}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground sm:col-span-3">
              {t("preferences.quietHoursHint")}
            </p>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={save} disabled={saving}>
          {saving ? t("common.saving") : t("preferences.save")}
        </Button>
        {message ? (
          <p role="status" className="text-sm font-medium text-success">
            {message}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
