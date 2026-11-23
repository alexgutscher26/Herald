import { consumeSenderVerification } from "@/features/email/verification";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Verify sender address",
  robots: { index: false, follow: false },
};

/**
 * Landing page for the single-use link sent by the sender identity form.
 * The query token is consumed once and never rendered.
 */
export default async function VerifySenderAddressPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token.trim() : "";
  const result = token
    ? await consumeSenderVerification(token)
    : ({ ok: false, error: "This verification link is incomplete." } as const);

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-lg items-center px-4 py-16">
      <div className="w-full rounded-lg border bg-card p-6 shadow-sm">
        <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Herald
        </p>
        <h1 className="text-lg font-semibold tracking-tight">
          {result.ok ? "Sender address verified" : "Verification link not valid"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {result.ok
            ? result.purpose === "from"
              ? "The From address is verified. Campaign and win-back sending can now use this identity."
              : "The reply-to address is verified. Campaign and win-back sending can now use this identity."
            : `${result.error} Open the newest verification email, or send a fresh link from Settings → Email.`}
        </p>
        <p className="mt-5 text-xs leading-5 text-muted-foreground">
          You can close this page and return to Herald.
        </p>
      </div>
    </main>
  );
}
