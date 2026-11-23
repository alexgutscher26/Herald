"use client";

import { useState } from "react";

export function PortalSupportForm({
  workspaceSlug,
  productSlug,
  initialSubject = "",
  initialBody = "",
}: {
  workspaceSlug: string;
  productSlug: string;
  /** Prefilled from `?subject=` and `?body=`, e.g. by an error boundary. */
  initialSubject?: string | undefined;
  initialBody?: string | undefined;
}) {
  const [body, setBody] = useState(initialBody.slice(0, 4000));
  const [subject, setSubject] = useState(initialSubject.slice(0, 160));
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    setError(null);
    try {
      const response = await fetch("/api/public/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceSlug,
          productSlug,
          subject: subject || null,
          body,
          email: email || null,
          sourceUrl: window.location.href,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Could not send the message.");
        setState("error");
        return;
      }
      setState("sent");
      setBody("");
      setSubject("");
    } catch {
      setError("Could not reach support. Try again.");
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <div className="rounded-lg border border-success/30 bg-success-muted p-5 text-sm text-success">
        <p className="font-medium">Message sent.</p>
        <p className="mt-1">
          The team can reply in your portal inbox. You can also return to the{" "}
          <a className="underline" href={`/p/${workspaceSlug}/${productSlug}/notifications`}>
            notifications page
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border bg-card p-5">
      <div className="space-y-1.5">
        <label htmlFor="support-subject" className="text-sm font-medium">
          Subject
        </label>
        <input
          id="support-subject"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          maxLength={160}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="support-email" className="text-sm font-medium">
          Email (optional)
        </label>
        <input
          id="support-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          maxLength={254}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="support-body" className="text-sm font-medium">
          How can we help?
        </label>
        <textarea
          id="support-body"
          required
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={7}
          maxLength={4000}
          className="w-full rounded-md border border-input bg-background p-3 text-sm"
        />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <button
        type="submit"
        disabled={state === "sending" || body.trim().length === 0}
        className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {state === "sending" ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}
