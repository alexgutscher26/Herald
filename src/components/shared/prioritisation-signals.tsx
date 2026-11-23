import {
  ArrowBigUp,
  Briefcase,
  CircleDollarSign,
  Gauge,
  Scale,
  Users,
  Zap,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { PrioritySignals } from "@/types";

/**
 * The prioritisation signals beside a vote count.
 *
 * A missing input renders as "—" with an explanation, never as 0. The
 * `title` text states how each number is derived so a reader can check it
 * against the stored data instead of trusting a score.
 */

function formatArr(value: number): string {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function PrioritisationSignals({
  signals,
  votes,
  className,
  showVotes = false,
}: {
  signals: PrioritySignals;
  votes?: number;
  className?: string;
  showVotes?: boolean;
}) {
  const items: { key: string; label: string; title: string; icon: typeof Gauge }[] = [
    {
      key: "priority",
      label:
        signals.priorityScore === null ? "—" : `${signals.priorityScore}`,
      title:
        signals.priorityScore === null
          ? "Priority score: needs an impact and an effort score"
          : `Priority score ${signals.priorityScore} = impact ${signals.impact}/5 ÷ effort ${signals.effort}/5 × demand ${Math.max(1, signals.requesterWeight)}`,
      icon: Zap,
    },
    {
      key: "impact",
      label: signals.impact === null ? "—" : `${signals.impact}/5`,
      title:
        signals.impact === null
          ? "Impact score: not set by the team yet"
          : `Impact score ${signals.impact} of 5, entered by the team`,
      icon: Gauge,
    },
    {
      key: "value-effort",
      label: signals.valuePerEffort === null ? "—" : `${signals.valuePerEffort}×`,
      title:
        signals.valuePerEffort === null
          ? "Value ÷ effort: needs both a business value and an effort score"
          : `Business value ${signals.businessValue}/5 ÷ effort ${signals.effort}/5`,
      icon: Scale,
    },
    {
      key: "requesters",
      label: `${signals.requesterWeight}`,
      title: `Requester weight ${signals.requesterWeight}: ${signals.requesterCount} distinct customer${
        signals.requesterCount === 1 ? "" : "s"
      }, plus one per $10,000 of known annual revenue or open deal value`,
      icon: Users,
    },
    {
      key: "arr",
      label: signals.knownArr === null ? "—" : formatArr(signals.knownArr),
      title:
        signals.knownArr === null
          ? "No requester has a company with stored ARR, MRR or CRM annual revenue"
          : `Known annual revenue across these requesters' companies: ${formatArr(
              signals.knownArr,
            )}`,
      icon: CircleDollarSign,
    },
  ];

  if (signals.knownOpenDealValue !== null) {
    items.push({
      key: "open-deal-value",
      label: formatArr(signals.knownOpenDealValue),
      title: `Open CRM deal value across these requesters' companies: ${formatArr(
        signals.knownOpenDealValue,
      )}. Team only; not shown on public surfaces.`,
      icon: Briefcase,
    });
  }

  return (
    <span
      className={cn("inline-flex flex-wrap items-center gap-1.5", className)}
      aria-label="Prioritisation signals"
    >
      {showVotes && typeof votes === "number" ? (
        <span
          className="inline-flex items-center gap-1 rounded border bg-background px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
          title={`${votes} vote${votes === 1 ? "" : "s"}`}
        >
          <ArrowBigUp className="size-3" aria-hidden="true" />
          {votes}
        </span>
      ) : null}
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <span
            key={item.key}
            title={item.title}
            className="inline-flex items-center gap-1 rounded border bg-background px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground"
          >
            <Icon className="size-3" aria-hidden="true" />
            {item.label}
          </span>
        );
      })}
    </span>
  );
}
