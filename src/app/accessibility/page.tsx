import type { Metadata } from "next";
import Link from "next/link";

import { LegalShell, ProseSection } from "@/components/trust/legal-shell";
import {
  ACCESSIBILITY_CONTACT,
  ACCESSIBILITY_LAST_UPDATED,
} from "@/features/trust/content";

export const metadata: Metadata = {
  title: "Accessibility",
  description:
    "Herald's accessibility target, the checks behind it, known limitations and how to report a barrier in the dashboard, public portal or widget.",
  alternates: { canonical: "/accessibility" },
};

const TESTED = [
  "Automated structural tests keep a skip link, one focusable main landmark, labelled controls, table headers, live regions and form-error associations in the dashboard, public surfaces and widget.",
  "The public audit and the dashboard audit are recorded separately, with the criterion, evidence and remaining manual check for each WCAG 2.2 AA success criterion.",
  "Keyboard paths are checked for the dashboard shell, forms, dialogs, the roadmap status menu, inbox rows and the widget launcher and panel.",
  "Contrast is calculated from the actual colour values. A workspace accent is derived into a 4.5:1 text shade for each public theme instead of trusting the raw hex.",
  "At narrow widths controls are at least 24 x 24 CSS pixels, and both the dashboard and widget reduce animation when the operating system asks for reduced motion.",
  "Uploaded inline release images prompt for alternative text before they are inserted, rather than storing an empty description.",
] as const;

export default function AccessibilityPage() {
  return (
    <LegalShell
      title="Accessibility"
      summary="Herald targets WCAG 2.2 AA across the dashboard, the public portal and the embeddable widget. This page states what is tested, what is not, and how to report a barrier."
    >
      <div className="rounded-lg border bg-muted/30 p-4 text-sm leading-relaxed text-muted-foreground">
        <p>
          Target:{" "}
          <strong className="font-medium text-foreground">WCAG 2.2 Level AA</strong>. This is a
          target and a published test contract, not a claim of independent certification. The
          statement was last reviewed on {ACCESSIBILITY_LAST_UPDATED}.
        </p>
        <p className="mt-2">
          Report a barrier to{" "}
          <a
            href={`mailto:${ACCESSIBILITY_CONTACT}`}
            className="font-medium underline underline-offset-2"
          >
            {ACCESSIBILITY_CONTACT}
          </a>
          . Include the page or flow, what you expected, what happened and the browser or
          assistive technology you used. Do not include customer content or passwords.
        </p>
      </div>

      <div className="mt-8">
        <ProseSection
          title="What is covered"
          paragraphs={[
            "The dashboard covers every signed-in product area: overview, releases, feedback, inbox and threads, roadmap, moderation, boards, help, API docs, widget, surveys, experiences, outbound, subscribers, segments, win-back, analytics, operations, integrations, import and settings.",
            "The public surface covers board and request pages, submit and comment forms, roadmap, changelog, help, notifications, login and preferences. The widget covers its launcher, panel navigation, inbox, thread, forms and CSAT prompt.",
          ]}
        />

        <section className="border-t py-6">
          <h2 className="text-base font-semibold tracking-tight">How it is checked</h2>
          <ul className="mt-3 space-y-2.5">
            {TESTED.map((item) => (
              <li key={item} className="flex gap-2 text-sm leading-relaxed text-muted-foreground">
                <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        <ProseSection
          title="Keyboard and assistive technology"
          paragraphs={[
            "Every dashboard route starts with a skip link to a focusable main landmark, and client-side navigation moves focus to the new page heading. Dialogs keep focus inside while open and return it to the control that opened them when they close.",
            "The roadmap supports drag and drop for pointer users, but every card also has a native status menu with an accessible name. Changing it announces the request and its new status. Dialogs, the command palette, inbox rows, filters and forms are operable without a pointer.",
          ]}
        />

        <ProseSection
          title="Known limitations"
          paragraphs={[
            "An independent human evaluation with NVDA and VoiceOver is not yet complete. Automated checks and browser-level keyboard checks cannot prove how every screen reader announces a page. We do not claim that pass until it has been run and recorded.",
            "The roadmap's pointer drag-and-drop gesture has no equivalent direct-manipulation mode. The per-card status menu is the accessible alternative and performs the same write.",
            "Third-party embedded content, customer-uploaded images outside release bodies, and content a workspace pastes into Markdown are outside Herald's direct control. Workspaces are responsible for meaningful alternative text on their own attachments and images.",
            "Older browsers that do not support :focus-visible, CSS custom properties or modern dialog semantics may receive a reduced experience. Current Chrome, Edge, Firefox and Safari are supported.",
          ]}
        />

        <ProseSection
          title="Feedback and escalation"
          paragraphs={[
            `If a barrier blocks a task, contact ${ACCESSIBILITY_CONTACT} and describe the flow. We will confirm receipt, reproduce the issue and tell you what we can change. Security reports belong at security@herald.app.`,
            "This statement is reviewed when the dashboard, portal or widget changes materially. It is linked from the trust centre, the marketing footer and the sitemap so the current version is easy to find.",
          ]}
        />

        <p className="border-t py-6 text-sm text-muted-foreground">
          Related documents:{" "}
          <Link href="/trust" className="font-medium underline underline-offset-2">
            security and trust
          </Link>{" "}
          and{" "}
          <Link href="/legal/privacy" className="font-medium underline underline-offset-2">
            privacy
          </Link>
          .
        </p>
      </div>
    </LegalShell>
  );
}
