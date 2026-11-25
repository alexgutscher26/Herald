import { ShieldCheck } from "lucide-react";

import { SettingsSection } from "@/components/shared/settings-section";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";

import { saveAgentActionAction } from "./actions";
import type {
  AgentActionSettingView,
  listAgentActionRuns,
} from "./agent-actions";

type ActionRun = Awaited<ReturnType<typeof listAgentActionRuns>>[number];

function formatUtc(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * Rule-bounded actions.
 *
 * The allowlist is fixed in code. A person must review each action before it
 * can run; every attempt, including a skipped one, is an audit row. There is
 * intentionally no control here for settings, billing, deletion or identity.
 */
export function AgentActionsView({
  workspaceSlug,
  productSlug,
  actions,
  runs,
  canManage,
}: {
  workspaceSlug: string;
  productSlug: string;
  actions: AgentActionSettingView[];
  runs: ActionRun[];
  canManage: boolean;
}) {
  const enabled = actions.filter((action) => action.enabled).length;

  return (
    <SettingsSection
      id="agent-actions"
      icon={ShieldCheck}
      title="Agent actions"
      description="A closed allowlist of things Mira may do beyond answering. Everything starts off, enabling records who reviewed it, and every attempt writes an audit row. Settings, billing, deletion and identity are never available here."
      badge={
        <StatusBadge tone={enabled > 0 ? "success" : "neutral"}>
          {enabled > 0 ? `${enabled} enabled` : "All off"}
        </StatusBadge>
      }
    >
      <div className="space-y-4">
        {actions.map((action) => (
          <div
            key={action.kind}
            className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border/80 bg-card p-4"
          >
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-foreground">{action.label}</p>
                <StatusBadge tone={action.enabled ? "success" : "neutral"}>
                  {action.enabled ? "Enabled" : "Off"}
                </StatusBadge>
              </div>
              <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
                {action.description}
              </p>
              <p className="text-xs text-muted-foreground">
                {action.enabled && action.reviewedAt
                  ? `Reviewed and enabled ${formatUtc(new Date(action.reviewedAt))}`
                  : "No one has approved this action for this product."}
              </p>
            </div>

            {canManage ? (
              <form action={saveAgentActionAction} className="shrink-0">
                <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
                <input type="hidden" name="productSlug" value={productSlug} />
                <input type="hidden" name="action" value={action.kind} />
                {action.enabled ? null : (
                  <input type="hidden" name="enabled" value="true" />
                )}
                <Button
                  type="submit"
                  size="sm"
                  variant={action.enabled ? "outline" : "default"}
                >
                  {action.enabled ? "Turn off" : "Review and enable"}
                </Button>
                {!action.enabled ? (
                  <p className="mt-1 max-w-40 text-[11px] leading-4 text-muted-foreground">
                    Enabling records you as the reviewer in the audit log.
                  </p>
                ) : null}
              </form>
            ) : (
              <p className="text-xs text-muted-foreground">
                Your role can view this allowlist but not change it.
              </p>
            )}
          </div>
        ))}

        <div className="rounded-lg border border-border/80 bg-muted/15">
          <div className="border-b border-border/70 px-4 py-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Recent action audit
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Every queued, skipped or failed attempt is recorded here, including the
              conversation it belongs to.
            </p>
          </div>
          {runs.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted-foreground">
              No agent action has been attempted in this product yet.
            </p>
          ) : (
            <ul className="divide-y">
              {runs.map((run) => (
                <li
                  key={run.id}
                  className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 text-xs"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="font-medium text-foreground">
                      {run.action === "send_transcript"
                        ? "Transcript email"
                        : run.action}{" "}
                      · {run.conversationSubject ?? "Conversation removed"}
                    </p>
                    <p className="text-muted-foreground">
                      {run.customerName ?? "Unknown customer"} · {run.detail}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge
                      tone={
                        run.status === "queued"
                          ? "success"
                          : run.status === "failed"
                            ? "danger"
                            : "neutral"
                      }
                    >
                      {run.status}
                    </StatusBadge>
                    <span className="tabular-nums text-muted-foreground">
                      {formatUtc(run.createdAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}
