import type { Metadata } from "next";
import Link from "next/link";

import { LegalShell, ProseSection } from "@/components/trust/legal-shell";

export const metadata: Metadata = {
  title: "Founding Lifetime terms",
  description:
    "The terms for Herald's Founding Lifetime offer: $499 once, 100 workspaces, a 30-day refund window, no renewal, and the limits that keep the offer sustainable.",
  alternates: { canonical: "/legal/lifetime" },
};

const SECTIONS = [
  {
    title: "The offer",
    paragraphs: [
      "Founding Lifetime is a one-time purchase of $499 plus applicable tax for one Herald workspace. It is limited to 100 workspaces in total. The price is charged once by Stripe at checkout; there is no subscription, no renewal date and no further lifetime payment.",
      "A purchased seat is tied to the workspace that bought it. It cannot be moved to another workspace, split across workspaces, or resold. One account may hold only one active or reserved lifetime purchase.",
    ],
  },
  {
    title: "What is included",
    paragraphs: [
      "A lifetime workspace includes unlimited products, boards and integrations, 15 team members, 5,000 emails a month and 150 Mira AI replies a month. It also includes the REST API, guest posting, private boards, custom branding, custom domains, advanced search and removal of the Herald attribution.",
      "Single sign-on, SCIM provisioning and identity masking are not included. They depend on ongoing identity-provider integration and are sold only with an Enterprise agreement.",
    ],
  },
  {
    title: "Monthly allowances",
    paragraphs: [
      "Emails and Mira replies are metered per calendar month and reset at the start of the next month. Unused allowances do not roll over. When the Mira allowance is exhausted, Mira hands the conversation to your team instead of generating another reply; the rest of the workspace keeps working.",
      "The allowances exist because email delivery and model inference are recurring costs. They are not a promise of unlimited future capacity, and they are the same limits shown in the plan catalogue at the time of purchase.",
    ],
  },
  {
    title: "Eligibility",
    paragraphs: [
      "The offer is available to a workspace on the Free plan whose owner does not already hold an active or reserved lifetime seat. Workspaces with an active or trialing subscription are not eligible while that subscription is active. Stripe must confirm the payment before lifetime access is granted.",
      "Herald may decline or cancel a purchase that circumvents the one-seat-per-account rule, is fraudulent, or is made by a workspace that is not eligible. In that case the payment is refunded in full.",
    ],
  },
  {
    title: "Refunds",
    paragraphs: [
      "You may request a full refund within 30 days of the purchase date by emailing support@herald.app from the address on the account. A full refund releases the seat, returns the workspace to the Free plan and ends lifetime access. Partial refunds do not revoke lifetime access and do not restore a seat.",
      "After the 30-day window, payments are non-refundable except where required by law. If Herald discontinues the hosted service, you receive at least 12 months' notice and a full export. If that happens within 36 months of purchase, you also receive a refund of the unused share on a straight-line 36-month basis.",
    ],
  },
  {
    title: "Changes and continuity",
    paragraphs: [
      "The included features and monthly allowances are the ones described above. Herald may improve or replace individual features, but will not reduce the lifetime plan's core allowances for existing purchasers. If Herald discontinues the hosted service, lifetime access ends with it; no renewal fees are owed because none exist.",
      "These terms sit alongside the main service terms. Where they conflict on the lifetime purchase, these terms control. They are a plain-language summary for checkout, not legal advice.",
    ],
  },
];

export default function LifetimeTermsPage() {
  return (
    <LegalShell
      title="Founding Lifetime terms"
      summary="One payment of $499 for one workspace, limited to 100 workspaces. A 30-day refund window, no renewal, and metered email and Mira allowances."
    >
      <div className="rounded-lg border bg-muted/30 p-4 text-sm leading-relaxed text-muted-foreground">
        <p>
          Founding Lifetime is a limited one-time offer, not a subscription. The exact price and
          remaining seat count are shown on the{" "}
          <Link href="/pricing" className="underline underline-offset-2">
            pricing page
          </Link>{" "}
          and at Stripe Checkout before you pay. Your seat is reserved when Checkout opens and is
          confirmed only after Stripe reports a successful payment.
        </p>
      </div>

      <div className="mt-8">
        {SECTIONS.map((section) => (
          <ProseSection
            key={section.title}
            title={section.title}
            paragraphs={section.paragraphs}
          />
        ))}
      </div>
    </LegalShell>
  );
}
