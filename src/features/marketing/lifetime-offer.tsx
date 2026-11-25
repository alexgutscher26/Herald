"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";

import { startLifetimeCheckoutAction } from "@/features/billing/actions";

/**
 * The Founding Lifetime band.
 *
 * Signed out, the CTA starts an account. Signed in with an eligible Free
 * workspace, it goes straight to Stripe Checkout. The remaining count is read
 * from the seat ledger on the server; the browser never chooses a seat.
 */
export function LifetimeOffer(props: {
  remaining: number | null;
  workspaceSlug: string | null;
  signedIn: boolean;
  /** When set, link here instead of starting checkout in place. */
  href?: string;
}) {
  const [busy, start] = useTransition();
  const soldOut = props.remaining === 0;
  const label = soldOut
    ? "Sold out"
    : props.href
      ? "See the founding offer"
      : props.signedIn && props.workspaceSlug
        ? "Claim a founding seat"
        : props.signedIn
          ? "Open your workspace"
          : "Claim a founding seat";

  function checkout() {
    start(async () => {
      if (!props.workspaceSlug) return;
      const result = await startLifetimeCheckoutAction({
        workspaceSlug: props.workspaceSlug,
      });
      if (!result.ok) {
        window.alert(result.error);
        return;
      }
      window.location.assign(result.data.url);
    });
  }

  return (
    <div className="mt-8 overflow-hidden rounded-lg border border-[#1f6b45]/35 bg-[#eef4ee]">
      <div className="flex flex-col gap-5 p-5 sm:p-7 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-[760px]">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#1f6b45]">
            Founding Lifetime
          </p>
          <h2 className="[font-family:var(--font-archivo)] mt-2 text-[1.7rem] font-semibold tracking-[-0.03em] sm:text-[2rem]">
            $499 once. 100 workspaces. No renewal.
          </h2>
          <p className="mt-2 text-[14px] leading-relaxed text-[#4e4a44]">
            Unlimited products, boards and integrations, the API, MCP and request briefs, 15
            teammates, 5,000 emails and 150 Mira replies a month. 30-day refund, no renewal. No SSO
            or identity masking. One workspace per account, and active subscribers are not eligible.
          </p>
          <p className="mt-3 text-[12px] text-[#6b6862]">
            {props.remaining === null
              ? "Founding seats are limited to 100 workspaces."
              : `${props.remaining} of 100 founding seats left.`}{" "}
            <Link className="font-medium text-[#1f6b45] underline" href="/legal/lifetime">
              Lifetime terms
            </Link>
            .
          </p>
        </div>

        <div className="shrink-0">
          {soldOut ? (
            <span className="inline-flex h-[42px] items-center rounded-md border border-[#d8d5ce] bg-white px-4 text-[13px] font-medium text-[#6b6862]">
              All 100 seats claimed
            </span>
          ) : props.href ? (
            <Link
              href={props.href}
              className="inline-flex h-[42px] items-center gap-2 rounded-md bg-[#1f6b45] px-4 text-[13px] font-semibold text-white hover:bg-[#185638]"
            >
              {label}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          ) : props.signedIn && !props.workspaceSlug ? (
            <Link
              href="/app"
              className="inline-flex h-[42px] items-center gap-2 rounded-md bg-[#1f6b45] px-4 text-[13px] font-semibold text-white hover:bg-[#185638]"
            >
              Open your workspace
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          ) : props.signedIn ? (
            <button
              type="button"
              onClick={checkout}
              disabled={busy}
              className="inline-flex h-[42px] items-center gap-2 rounded-md bg-[#1f6b45] px-4 text-[13px] font-semibold text-white hover:bg-[#185638] disabled:opacity-60"
            >
              {busy ? "Opening Stripe…" : label}
              <ArrowRight className="size-4" aria-hidden="true" />
            </button>
          ) : (
            <Link
              href="/sign-up?offer=lifetime"
              className="inline-flex h-[42px] items-center gap-2 rounded-md bg-[#1f6b45] px-4 text-[13px] font-semibold text-white hover:bg-[#185638]"
            >
              {label}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
