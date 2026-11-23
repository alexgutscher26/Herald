import { Headset, Inbox } from "lucide-react";

import { SettingsSection } from "@/components/shared/settings-section";
import { StatusBadge } from "@/components/shared/status-badge";
import { TimeZoneSelect } from "@/components/shared/timezone-select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import type { OperatorSettings } from "./service";
import { saveInboundEmailAction, saveOperatorAction } from "./actions";

/**
 * Support settings.
 *
 * Plain forms: each control posts to a server action, which re-checks
 * `settings:manage`. No setting is trusted from the browser, and the page
 * stays usable without JavaScript. Timezone is an IANA name validated by the
 * service; schedule is one weekly window, which the schema can extend to many.
 */

const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

const HOURS = Array.from({ length: 48 }, (_, index) => {
  const hour = String(Math.floor(index / 2)).padStart(2, "0");
  return `${hour}:${index % 2 === 0 ? "00" : "30"}`;
});

const CHECKBOX_CLASS = "size-4 rounded border-input accent-[var(--primary)]";
const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-card px-2.5 text-sm shadow-none transition-colors focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50";

export function SupportSettingsView({
  workspaceSlug,
  productSlug,
  email,
  operators,
  canManage,
}: {
  workspaceSlug: string;
  productSlug: string;
  email: { address: string; enabled: boolean; displayName: string };
  operators: OperatorSettings[];
  canManage: boolean;
}) {
  return (
    <div className="space-y-6">
      <SettingsSection
        icon={Inbox}
        title="Email forwarding"
        description="Forward mail to the address below and it opens a conversation. Replies from a known customer land in the same thread; a paused address stops new mail without deleting its history."
        badge={
          email.enabled ? (
            <StatusBadge tone="success">Accepting mail</StatusBadge>
          ) : (
            <StatusBadge tone="neutral">Paused</StatusBadge>
          )
        }
      >
        <div className="rounded-lg border border-border/80 bg-muted/20 p-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Inbound address
          </p>
          <p className="mt-1 break-all font-mono text-[13px] text-foreground">
            {email.address}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            This address is unique to the product and can be rotated below.
          </p>
        </div>

        <form action={saveInboundEmailAction} className="mt-4 space-y-4">
          <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
          <input type="hidden" name="productSlug" value={productSlug} />

          <label className="flex items-center justify-between gap-4 rounded-lg border border-border/80 bg-muted/15 px-3.5 py-3">
            <span>
              <span className="block text-sm font-medium text-foreground">
                Accept inbound email
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Turning this off keeps existing threads and history.
              </span>
            </span>
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={email.enabled}
              disabled={!canManage}
              className={CHECKBOX_CLASS}
            />
          </label>

          <div className="grid gap-1.5">
            <Label htmlFor="inbound-display-name">Sender name</Label>
            <Input
              id="inbound-display-name"
              name="displayName"
              defaultValue={email.displayName}
              maxLength={80}
              disabled={!canManage}
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              name="regenerate"
              disabled={!canManage}
              className={CHECKBOX_CLASS}
            />
            Rotate the address (old mail stops arriving)
          </label>

          <div className="flex justify-end border-t border-border/70 pt-4">
            <Button type="submit" size="sm" disabled={!canManage}>
              Save email settings
            </Button>
          </div>
        </form>
      </SettingsSection>

      <SettingsSection
        icon={Headset}
        title="Operators"
        description="Owners and admins can take conversations. Availability is a heartbeat plus your own weekly window; appearing offline always wins. The widget shows the team as online when at least one operator is available."
        badge={
          <StatusBadge tone="neutral">
            {operators.length} {operators.length === 1 ? "teammate" : "teammates"}
          </StatusBadge>
        }
      >
        <ul className="space-y-4">
          {operators.map((operator) => {
            const schedule = operator.operator?.schedule ?? null;
            const window = schedule?.[0] ?? null;
            return (
              <li
                key={operator.userId}
                className="overflow-hidden rounded-[10px] border border-border/80 bg-muted/10"
              >
                <div className="flex items-center gap-3 border-b border-border/70 bg-card px-4 py-3">
                  <Avatar className="size-9">
                    {operator.image && <AvatarImage src={operator.image} alt="" />}
                    <AvatarFallback>
                      {operator.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium text-foreground">
                        {operator.name}
                      </p>
                      <StatusBadge tone="neutral" className="capitalize">
                        {operator.role}
                      </StatusBadge>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {operator.email} ·{" "}
                      {operator.operator?.lastSeenAt
                        ? `seen ${new Date(operator.operator.lastSeenAt).toISOString().slice(0, 16).replace("T", " ")}`
                        : "never seen"}
                    </p>
                  </div>
                </div>

                <form action={saveOperatorAction} className="space-y-4 p-4">
                  <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
                  <input type="hidden" name="productSlug" value={productSlug} />
                  <input type="hidden" name="userId" value={operator.userId} />

                  <div className="space-y-3 rounded-lg border border-border/80 bg-card p-3.5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Availability
                    </p>

                    <div className="grid gap-1.5">
                      <Label htmlFor={`timezone-${operator.userId}`}>
                        Timezone (IANA)
                      </Label>
                      <TimeZoneSelect
                        id={`timezone-${operator.userId}`}
                        name="timezone"
                        value={operator.operator?.timezone ?? "UTC"}
                        disabled={!canManage}
                        className={`${SELECT_CLASS} w-full`}
                      />
                    </div>

                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="useSchedule"
                        defaultChecked={schedule !== null}
                        disabled={!canManage}
                        className={CHECKBOX_CLASS}
                      />
                      Only available during set hours
                    </label>

                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <select
                        name="start"
                        defaultValue={window?.start ?? "09:00"}
                        disabled={!canManage}
                        className={SELECT_CLASS}
                        aria-label="Schedule start time"
                      >
                        {HOURS.map((hour) => (
                          <option key={hour} value={hour}>
                            {hour}
                          </option>
                        ))}
                      </select>
                      <span className="text-muted-foreground">to</span>
                      <select
                        name="end"
                        defaultValue={window?.end ?? "17:00"}
                        disabled={!canManage}
                        className={SELECT_CLASS}
                        aria-label="Schedule end time"
                      >
                        {HOURS.map((hour) => (
                          <option key={hour} value={hour}>
                            {hour}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {WEEKDAYS.map((day) => (
                        <label key={day.value} className="cursor-pointer">
                          <input
                            type="checkbox"
                            name="days"
                            value={day.value}
                            defaultChecked={
                              window ? window.days.includes(day.value) : day.value <= 5
                            }
                            disabled={!canManage}
                            className="peer sr-only"
                          />
                          <span className="flex h-8 min-w-9 items-center justify-center rounded-md border border-input bg-card px-2 text-xs font-medium text-muted-foreground transition-colors peer-checked:border-primary peer-checked:bg-primary/10 peer-checked:text-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-disabled:opacity-50">
                            {day.label}
                          </span>
                        </label>
                      ))}
                    </div>

                    <div className="grid gap-2 border-t border-border/70 pt-3 sm:grid-cols-2">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="availableWhileUsing"
                          defaultChecked={operator.operator?.availableWhileUsing ?? true}
                          disabled={!canManage}
                          className={CHECKBOX_CLASS}
                        />
                        Available while using the dashboard
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="appearOffline"
                          defaultChecked={operator.operator?.appearOffline ?? false}
                          disabled={!canManage}
                          className={CHECKBOX_CLASS}
                        />
                        Appear offline to customers
                      </label>
                    </div>
                  </div>

                  <fieldset className="rounded-lg border border-border/80 bg-card p-3.5">
                    <legend className="px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Notifications
                    </legend>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="notifyNewConversations"
                          defaultChecked={
                            operator.operator?.notifyNewConversations ?? true
                          }
                          disabled={!canManage}
                          className={CHECKBOX_CLASS}
                        />
                        New conversations
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="notifyReplies"
                          defaultChecked={operator.operator?.notifyReplies ?? true}
                          disabled={!canManage}
                          className={CHECKBOX_CLASS}
                        />
                        Customer replies
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="notifyInApp"
                          defaultChecked={operator.operator?.notifyInApp ?? true}
                          disabled={!canManage}
                          className={CHECKBOX_CLASS}
                        />
                        In the dashboard
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="notifyEmail"
                          defaultChecked={operator.operator?.notifyEmail ?? true}
                          disabled={!canManage}
                          className={CHECKBOX_CLASS}
                        />
                        By email
                      </label>
                    </div>
                  </fieldset>

                  <fieldset className="rounded-lg border border-border/80 bg-card p-3.5">
                    <legend className="px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Away reply
                    </legend>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="awayReplyEnabled"
                        defaultChecked={operator.operator?.awayReplyEnabled ?? false}
                        disabled={!canManage}
                        className={CHECKBOX_CLASS}
                      />
                      Send once while the whole team is away
                    </label>
                    <Textarea
                      name="awayReplyBody"
                      defaultValue={
                        operator.operator?.awayReplyBody ??
                        "Thanks for your message. Our team is away right now and will reply as soon as we are back."
                      }
                      rows={3}
                      maxLength={2000}
                      disabled={!canManage}
                      className="mt-2.5"
                      aria-label="Away reply message"
                    />
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      Sent at most once per thread, and only when no operator is available.
                      A human reply resets it.
                    </p>
                  </fieldset>

                  <div className="flex justify-end border-t border-border/70 pt-4">
                    <Button type="submit" size="sm" disabled={!canManage}>
                      Save operator
                    </Button>
                  </div>
                </form>
              </li>
            );
          })}
        </ul>
      </SettingsSection>
    </div>
  );
}
