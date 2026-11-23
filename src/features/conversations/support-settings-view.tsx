import { Clock, ListChecks, Star } from "lucide-react";

import { SettingsSection } from "@/components/shared/settings-section";
import { StatusBadge } from "@/components/shared/status-badge";
import { TimeZoneSelect } from "@/components/shared/timezone-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { IntakeChannel, OperatorScheduleWindow } from "@/db/schema/support";

import {
  archiveIntakeQuestionAction,
  createIntakeQuestionAction,
  saveCsatAction,
  saveSlaAction,
} from "./support-actions";

/**
 * Support feedback settings: CSAT and structured intake.
 *
 * Both features are optional and off by default. The forms are server-rendered
 * and re-check `settings:manage`; nothing here is trusted from the browser.
 */

const CHECKBOX_CLASS = "size-4 rounded border-input accent-[var(--primary)]";
const SELECT_CLASS =
  "h-9 rounded-full border border-input bg-card px-2.5 text-sm shadow-none transition-colors focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50";
const SLA_DAYS: Array<{ value: number; label: string }> = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

type QuestionRow = {
  id: string;
  key: string;
  label: string;
  kind: "text" | "select";
  options: string[];
  channel: IntakeChannel;
  boardId: string | null;
  boardName: string | null;
  active: boolean;
};

export function ConversationFeedbackSettingsView({
  workspaceSlug,
  productSlug,
  csatEnabled,
  sla,
  questions,
  boards,
  canManage,
}: {
  workspaceSlug: string;
  productSlug: string;
  csatEnabled: boolean;
  sla: {
    enabled: boolean;
    firstResponseMinutes: number;
    businessHours: OperatorScheduleWindow[] | null;
    timezone: string;
  };
  questions: QuestionRow[];
  boards: Array<{ id: string; name: string }>;
  canManage: boolean;
}) {
  const slaWindow = sla.businessHours?.[0] ?? null;
  const slaDays = slaWindow?.days ?? [1, 2, 3, 4, 5];

  return (
    <div className="space-y-6">
      <SettingsSection
        icon={Clock}
        title="First-response SLA"
        description="An opt-in business-hours clock on each customer message. The inbox shows the remaining time, and the minute cron sends one in-app breach alert per waiting period. This is not a full help-desk SLA engine: one target, one weekly window set, no escalation tree."
        badge={
          <StatusBadge tone={sla.enabled ? "success" : "neutral"}>
            {sla.enabled ? `${sla.firstResponseMinutes} min target` : "Off"}
          </StatusBadge>
        }
      >
        <form action={saveSlaAction} className="space-y-4">
          <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
          <input type="hidden" name="productSlug" value={productSlug} />

          <label className="flex items-center justify-between gap-4 rounded-lg border border-border/80 bg-muted/15 px-3.5 py-3">
            <span>
              <span className="block text-sm font-medium text-foreground">
                Track a first-response target
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Resolved, spam and archived threads are excluded. A team or Juno reply pauses the
                clock until the customer writes again.
              </span>
            </span>
            <input
              type="checkbox"
              name="slaEnabled"
              defaultChecked={sla.enabled}
              disabled={!canManage}
              className={CHECKBOX_CLASS}
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="sla-minutes">Target business minutes</Label>
              <Input
                id="sla-minutes"
                name="slaFirstResponseMinutes"
                type="number"
                min={5}
                max={10080}
                defaultValue={sla.firstResponseMinutes}
                disabled={!canManage}
              />
              <p className="text-xs text-muted-foreground">240 is four business hours.</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sla-timezone">Timezone (IANA)</Label>
              <TimeZoneSelect
                id="sla-timezone"
                name="slaTimezone"
                value={sla.timezone}
                disabled={!canManage}
                className={`${SELECT_CLASS} w-full`}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="useBusinessHours"
              defaultChecked={sla.businessHours !== null}
              disabled={!canManage}
              className={CHECKBOX_CLASS}
            />
            Only count business hours
          </label>

          <div className="grid gap-4 rounded-lg border border-border/80 bg-muted/10 p-3.5 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
            <div className="grid gap-1.5 sm:col-span-3">
              <Label>Business days</Label>
              <div className="flex flex-wrap gap-3">
                {SLA_DAYS.map((day) => (
                  <label key={day.value} className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      name="slaDay"
                      value={day.value}
                      defaultChecked={slaDays.includes(day.value)}
                      disabled={!canManage}
                      className={CHECKBOX_CLASS}
                    />
                    {day.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sla-start">Opens</Label>
              <Input
                id="sla-start"
                name="slaStart"
                type="time"
                defaultValue={slaWindow?.start ?? "09:00"}
                disabled={!canManage}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sla-end">Closes</Label>
              <Input
                id="sla-end"
                name="slaEnd"
                type="time"
                defaultValue={slaWindow?.end ?? "17:00"}
                disabled={!canManage}
              />
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-3">
              Leave “Only count business hours” off for a 24/7 clock. Overnight windows are allowed;
              time outside the selected days is not counted.
            </p>
          </div>

          <div className="flex justify-end border-t border-border/70 pt-4">
            <Button type="submit" size="sm" disabled={!canManage}>
              Save SLA setting
            </Button>
          </div>
        </form>
      </SettingsSection>
      <SettingsSection
        icon={Star}
        title="Customer satisfaction"
        description="After a thread is resolved, the widget may ask for one rating from 1 to 5. The rating is stored on the conversation, never as a message, and is aggregated on Analytics. Off by default."
        badge={
          <StatusBadge tone={csatEnabled ? "success" : "neutral"}>
            {csatEnabled ? "Asking for ratings" : "Off"}
          </StatusBadge>
        }
      >
        <form action={saveCsatAction} className="space-y-4">
          <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
          <input type="hidden" name="productSlug" value={productSlug} />

          <label className="flex items-center justify-between gap-4 rounded-lg border border-border/80 bg-muted/15 px-3.5 py-3">
            <span>
              <span className="block text-sm font-medium text-foreground">
                Ask for a CSAT rating on resolution
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                One request per thread, at most. If the thread is reopened and resolved again within seven days, the customer can update the rating once instead of receiving a second request.
              </span>
            </span>
            <input
              type="checkbox"
              name="csatEnabled"
              defaultChecked={csatEnabled}
              disabled={!canManage}
              className={CHECKBOX_CLASS}
            />
          </label>

          <div className="flex justify-end border-t border-border/70 pt-4">
            <Button type="submit" size="sm" disabled={!canManage}>
              Save CSAT setting
            </Button>
          </div>
        </form>
      </SettingsSection>

      <SettingsSection
        icon={ListChecks}
        title="Structured intake"
        description="Optional questions asked before a customer starts a widget conversation or submits to a board. Answers are stored as customer traits; every question is skippable, and a guest can always send without answering."
        badge={
          <StatusBadge tone="neutral">
            {questions.filter((question) => question.active).length} active
          </StatusBadge>
        }
      >
        {questions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No intake questions yet. Add a plan, use case or severity question below.
          </p>
        ) : (
          <ul className="space-y-2">
            {questions.map((question) => (
              <li
                key={question.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-border/80 bg-muted/10 px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {question.label}
                    <span className="ml-2 font-mono text-[11px] font-normal text-muted-foreground">
                      {question.key}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {question.channel === "widget"
                      ? "Widget"
                      : question.boardName
                        ? `Board · ${question.boardName}`
                        : "All boards"}{" "}
                    · {question.kind === "select" ? question.options.join(", ") : "Free text"}
                    {question.active ? "" : " · archived"}
                  </p>
                </div>
                {question.active ? (
                  <form action={archiveIntakeQuestionAction}>
                    <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
                    <input type="hidden" name="productSlug" value={productSlug} />
                    <input type="hidden" name="questionId" value={question.id} />
                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      disabled={!canManage}
                    >
                      Archive
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <form action={createIntakeQuestionAction} className="mt-5 space-y-4 border-t border-border/70 pt-5">
          <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
          <input type="hidden" name="productSlug" value={productSlug} />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="intake-channel">Ask on</Label>
              <select
                id="intake-channel"
                name="channel"
                defaultValue="widget"
                disabled={!canManage}
                className={SELECT_CLASS}
              >
                <option value="widget">Widget conversations</option>
                <option value="board">Board submissions</option>
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="intake-board">Board (board questions only)</Label>
              <select
                id="intake-board"
                name="boardId"
                defaultValue=""
                disabled={!canManage}
                className={SELECT_CLASS}
              >
                <option value="">All boards</option>
                {boards.map((board) => (
                  <option key={board.id} value={board.id}>
                    {board.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="intake-key">Trait key</Label>
              <Input
                id="intake-key"
                name="key"
                placeholder="plan"
                maxLength={40}
                disabled={!canManage}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="intake-label">Question</Label>
              <Input
                id="intake-label"
                name="label"
                placeholder="Which plan are you on?"
                maxLength={120}
                disabled={!canManage}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="intake-kind">Answer type</Label>
              <select
                id="intake-kind"
                name="kind"
                defaultValue="text"
                disabled={!canManage}
                className={SELECT_CLASS}
              >
                <option value="text">Free text</option>
                <option value="select">Choice</option>
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="intake-options">Choices (comma or line separated)</Label>
              <Input
                id="intake-options"
                name="options"
                placeholder="Free, Starter, Pro"
                maxLength={400}
                disabled={!canManage}
              />
            </div>
          </div>

          <div className="flex justify-end border-t border-border/70 pt-4">
            <Button type="submit" size="sm" disabled={!canManage}>
              Add question
            </Button>
          </div>
        </form>
      </SettingsSection>
    </div>
  );
}
