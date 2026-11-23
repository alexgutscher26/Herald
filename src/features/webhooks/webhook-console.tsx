"use client";

import { Copy, KeyRound, Plus, RotateCw, Send, Webhook } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type WebhookConsoleEndpoint = {
  id: string;
  name: string;
  url: string;
  events: string[];
  active: boolean;
  previousSecretExpiresAt: string | null;
};

export type WebhookConsoleDelivery = {
  id: string;
  event: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  createdAt: string;
  webhook: { id: string; name: string; url: string };
};

export type WebhookConsoleEvent = {
  event: string;
  label: string;
  description: string;
  example: Record<string, unknown>;
  envelope: Record<string, unknown>;
};

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    // Fall through for an HTTP origin without clipboard permission.
  }
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  if (!copied) throw new Error("The clipboard is unavailable.");
}

function endpointHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });
}

export function WebhookConsole({
  workspaceSlug,
  endpoints: initialEndpoints,
  failedDeliveries,
  events,
}: {
  workspaceSlug: string;
  endpoints: WebhookConsoleEndpoint[];
  failedDeliveries: WebhookConsoleDelivery[];
  events: WebhookConsoleEvent[];
}) {
  const router = useRouter();
  const [endpoints, setEndpoints] = useState(initialEndpoints);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>(
    events.map((event) => event.event),
  );
  const [newSecret, setNewSecret] = useState<{
    secret: string;
    endpoint: string;
    previousValidUntil?: string | undefined;
  } | null>(null);
  const [testEvent, setTestEvent] = useState<Record<string, string>>({});
  const [selectedDeliveries, setSelectedDeliveries] = useState<string[]>([]);
  const [busy, startBusy] = useTransition();

  function toggleEvent(event: string) {
    setSelectedEvents((current) =>
      current.includes(event)
        ? current.filter((item) => item !== event)
        : [...current, event],
    );
  }

  function copySecret(value: string) {
    void copyText(value)
      .then(() => toast.success("Signing secret copied."))
      .catch(() => toast.error("Could not copy. Select the value and copy it manually."));
  }

  function createEndpoint(endpointName: string, endpointUrl: string) {
    startBusy(async () => {
      const response = await fetch(`/api/app/${encodeURIComponent(workspaceSlug)}/webhooks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: endpointName, url: endpointUrl, events: selectedEvents }),
      });
      const result = (await response.json().catch(() => null)) as
        | {
            error?: string;
            secret?: string;
            webhook?: { id: string; name: string; url: string; events: string[] };
          }
        | null;
      if (!response.ok || !result?.webhook || !result.secret) {
        toast.error(result?.error ?? "Could not create the endpoint.");
        return;
      }
      setEndpoints((current) => [
        {
          id: result.webhook!.id,
          name: result.webhook!.name,
          url: result.webhook!.url,
          events: result.webhook!.events,
          active: true,
          previousSecretExpiresAt: null,
        },
        ...current,
      ]);
      setNewSecret({ secret: result.secret, endpoint: result.webhook.name });
      setName("");
      setUrl("");
      toast.success("Endpoint created. Copy its signing secret now.");
      router.refresh();
    });
  }

  function rotate(endpoint: WebhookConsoleEndpoint) {
    startBusy(async () => {
      const response = await fetch(
        `/api/app/${encodeURIComponent(workspaceSlug)}/webhooks/${endpoint.id}/rotate`,
        { method: "POST" },
      );
      const result = (await response.json().catch(() => null)) as
        | { error?: string; secret?: string; previous_valid_until?: string }
        | null;
      if (!response.ok || !result?.secret) {
        toast.error(result?.error ?? "Could not rotate the secret.");
        return;
      }
      setNewSecret({
        secret: result.secret,
        endpoint: endpoint.name,
        previousValidUntil: result.previous_valid_until,
      });
      setEndpoints((current) =>
        current.map((row) =>
          row.id === endpoint.id
            ? { ...row, previousSecretExpiresAt: result.previous_valid_until ?? null }
            : row,
        ),
      );
      toast.success("Signing secret rotated. The old secret stays valid for 24 hours.");
      router.refresh();
    });
  }

  function pause(endpoint: WebhookConsoleEndpoint) {
    startBusy(async () => {
      const response = await fetch(
        `/api/app/${encodeURIComponent(workspaceSlug)}/webhooks/${endpoint.id}`,
        { method: "DELETE" },
      );
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        toast.error(result?.error ?? "Could not pause the endpoint.");
        return;
      }
      setEndpoints((current) =>
        current.map((row) => (row.id === endpoint.id ? { ...row, active: false } : row)),
      );
      router.refresh();
    });
  }

  function sendTest(endpoint: WebhookConsoleEndpoint) {
    const event = testEvent[endpoint.id] ?? endpoint.events[0];
    if (!event) {
      toast.error("This endpoint has no subscribed event.");
      return;
    }
    startBusy(async () => {
      const response = await fetch(
        `/api/app/${encodeURIComponent(workspaceSlug)}/webhooks/${endpoint.id}/test`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ event }),
        },
      );
      const result = (await response.json().catch(() => null)) as
        | { error?: string; delivery?: { id: string } }
        | null;
      if (!response.ok) {
        toast.error(result?.error ?? "Could not queue the test event.");
        return;
      }
      toast.success(`Test ${event} queued. The delivery log records the real response.`);
      router.refresh();
    });
  }

  function replaySelected() {
    if (selectedDeliveries.length === 0) return;
    startBusy(async () => {
      const response = await fetch(
        `/api/app/${encodeURIComponent(workspaceSlug)}/webhooks/deliveries/replay`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ delivery_ids: selectedDeliveries }),
        },
      );
      const result = (await response.json().catch(() => null)) as
        | { error?: string; replayed?: number }
        | null;
      if (!response.ok) {
        toast.error(result?.error ?? "Could not replay those deliveries.");
        return;
      }
      const replayed = result?.replayed ?? 0;
      toast.success(`${replayed} ${replayed === 1 ? "delivery" : "deliveries"} queued for replay.`);
      setSelectedDeliveries([]);
      router.refresh();
    });
  }

  const allSelected =
    failedDeliveries.length > 0 && selectedDeliveries.length === failedDeliveries.length;

  return (
    <div className="space-y-5">
      {newSecret ? (
        <Card className="border-warning/50 bg-warning-muted/30">
          <CardContent className="space-y-3 p-5">
            <div className="flex items-start gap-2">
              <KeyRound className="mt-0.5 size-4 text-warning" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold">Copy the signing secret for {newSecret.endpoint}</p>
                <p className="text-xs text-muted-foreground">
                  It is shown once. {newSecret.previousValidUntil
                    ? `The previous secret stays valid until ${formatDateTime(newSecret.previousValidUntil)}.`
                    : "Store it in the receiver's secret manager."}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-md border bg-background px-2.5 py-2 text-xs">
                {newSecret.secret}
              </code>
              <Button type="button" size="sm" variant="outline" onClick={() => copySecret(newSecret.secret)}>
                <Copy aria-hidden="true" /> Copy
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setNewSecret(null)}>
                Dismiss
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
              <Webhook className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">Endpoints</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Each delivery is signed with HMAC-SHA256 over the timestamp and raw body. A
                rotated secret is accepted for 24 hours and sent as{" "}
                <code>x-herald-signature-previous</code>.
              </p>
            </div>
          </div>

          {endpoints.length > 0 ? (
            <ul className="divide-y rounded-md border">
              {endpoints.map((endpoint) => (
                <li key={endpoint.id} className="space-y-3 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{endpoint.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {endpointHost(endpoint.url)} · {endpoint.events.length} event
                        {endpoint.events.length === 1 ? "" : "s"}
                      </p>
                      {endpoint.previousSecretExpiresAt ? (
                        <p className="mt-1 text-xs text-warning">
                          Previous secret valid until {formatDateTime(endpoint.previousSecretExpiresAt)}
                        </p>
                      ) : null}
                    </div>
                    <StatusBadge tone={endpoint.active ? "success" : "neutral"}>
                      {endpoint.active ? "Active" : "Paused"}
                    </StatusBadge>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="min-w-44 flex-1 space-y-1 text-xs">
                      <span className="text-muted-foreground">Test event</span>
                      <select
                        className="h-8 w-full rounded-md border bg-background px-2 text-xs"
                        value={testEvent[endpoint.id] ?? endpoint.events[0] ?? ""}
                        onChange={(event) =>
                          setTestEvent((current) => ({
                            ...current,
                            [endpoint.id]: event.target.value,
                          }))
                        }
                        disabled={!endpoint.active}
                      >
                        {endpoint.events.map((event) => (
                          <option key={event} value={event}>
                            {event}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => sendTest(endpoint)}
                      disabled={busy || !endpoint.active}
                    >
                      <Send aria-hidden="true" /> Send test
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => rotate(endpoint)}
                      disabled={busy}
                    >
                      <RotateCw aria-hidden="true" /> Rotate secret
                    </Button>
                    {endpoint.active ? (
                      <ConfirmDialog
                        trigger={
                          <Button type="button" size="sm" variant="ghost" disabled={busy}>
                            Pause
                          </Button>
                        }
                        title={`Pause ${endpoint.name}?`}
                        description="New events will not be queued for this endpoint. You can create a new endpoint later to resume deliveries."
                        confirmLabel="Pause endpoint"
                        onConfirm={() => pause(endpoint)}
                      />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No endpoints yet.</p>
          )}

          <form
            className="space-y-3 border-t pt-4"
            action={(formData) => {
              const formName = String(formData.get("name") ?? "");
              const formUrl = String(formData.get("url") ?? "");
              setName(formName);
              setUrl(formUrl);
              createEndpoint(formName, formUrl);
            }}
          >
            <p className="text-sm font-medium">Add an endpoint</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="webhook-name">Name</Label>
                <Input
                  id="webhook-name"
                  name="name"
                  maxLength={120}
                  required
                  placeholder="Production alerts"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="webhook-url">HTTPS URL</Label>
                <Input
                  id="webhook-url"
                  name="url"
                  type="url"
                  required
                  placeholder="https://hooks.example.com/herald"
                />
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {events.map((event) => (
                <label key={event.event} className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={selectedEvents.includes(event.event)}
                    onChange={() => toggleEvent(event.event)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block font-medium">{event.label}</span>
                    <code className="text-[10px] text-muted-foreground">{event.event}</code>
                  </span>
                </label>
              ))}
            </div>
            <Button type="submit" size="sm" disabled={busy || selectedEvents.length === 0}>
              <Plus aria-hidden="true" /> Create endpoint
            </Button>
            {name || url ? (
              <p className="text-xs text-muted-foreground">
                The form submits when you press the button; nothing is sent to the receiver until
                the cron worker claims a pending delivery.
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-5">
          <div>
            <h2 className="text-sm font-semibold">Dead-letter deliveries</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Failed and sandbox-skipped deliveries across every endpoint. Replay puts the original
              frozen payload back at the front of the queue.
            </p>
          </div>

          {failedDeliveries.length > 0 ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(event) =>
                      setSelectedDeliveries(
                        event.target.checked ? failedDeliveries.map((row) => row.id) : [],
                      )
                    }
                  />
                  Select all
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={replaySelected}
                  disabled={busy || selectedDeliveries.length === 0}
                >
                  Replay selected ({selectedDeliveries.length})
                </Button>
              </div>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="border-b text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Select</th>
                      <th className="px-3 py-2 font-medium">Endpoint</th>
                      <th className="px-3 py-2 font-medium">Event</th>
                      <th className="px-3 py-2 font-medium">Attempts</th>
                      <th className="px-3 py-2 font-medium">Last response</th>
                      <th className="px-3 py-2 font-medium">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {failedDeliveries.map((delivery) => (
                      <tr key={delivery.id} className="border-b last:border-0">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            aria-label={`Select delivery ${delivery.id}`}
                            checked={selectedDeliveries.includes(delivery.id)}
                            onChange={(event) =>
                              setSelectedDeliveries((current) =>
                                event.target.checked
                                  ? [...current, delivery.id]
                                  : current.filter((id) => id !== delivery.id),
                              )
                            }
                          />
                        </td>
                        <td className="px-3 py-2">
                          <p className="font-medium">{delivery.webhook.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {endpointHost(delivery.webhook.url)}
                          </p>
                        </td>
                        <td className="px-3 py-2">
                          <code className="text-xs">{delivery.event}</code>
                        </td>
                        <td className="px-3 py-2 tabular-nums">{delivery.attempts}</td>
                        <td className="max-w-xs px-3 py-2">
                          <span className="block text-xs">
                            {delivery.responseStatus ?? "No response"}
                          </span>
                          {delivery.error ? (
                            <span className="block break-words text-xs text-destructive">
                              {delivery.error}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {formatDateTime(delivery.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              No failed or skipped deliveries.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-5">
          <div>
            <h2 className="text-sm font-semibold">Event catalogue</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The envelope always carries <code>id</code>, <code>type</code>, <code>created_at</code>,{" "}
              <code>workspace_id</code> and <code>data</code>. Retries reuse the same body and id.
            </p>
          </div>
          <ul className="space-y-2">
            {events.map((event) => (
              <li key={event.event} className="rounded-md border bg-muted/20 p-3">
                <details>
                  <summary className="cursor-pointer text-sm font-medium">
                    {event.label} <code className="ml-1 text-xs text-muted-foreground">{event.event}</code>
                  </summary>
                  <p className="mt-2 text-xs text-muted-foreground">{event.description}</p>
                  <pre className="mt-2 overflow-x-auto rounded-md border bg-background p-2 text-[11px] leading-relaxed">
                    {JSON.stringify(event.envelope, null, 2)}
                  </pre>
                </details>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
