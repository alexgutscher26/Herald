import Link from "next/link";
import { redirect } from "next/navigation";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { acceptWorkspaceInvitation, getInvitationPreview } from "@/features/workspace-settings/invitations";
import { getSessionUser } from "@/lib/authz";
import { normalizeEmail } from "@/lib/email";
import { withRedirectParam } from "@/lib/redirect";

export const metadata = { title: "Workspace invitation" };

function normalizedEmailsMatch(a: string, b: string): boolean {
  return normalizeEmail(a) === normalizeEmail(b);
}

async function accept(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  const user = await getSessionUser();
  if (!user) redirect(withRedirectParam("/sign-in", `/invite/${encodeURIComponent(token)}`));
  const result = await acceptWorkspaceInvitation({
    token,
    userId: user.id,
    userEmail: user.email,
  });
  if (!result.ok) redirect(`/invite/${encodeURIComponent(token)}?error=${encodeURIComponent(result.error)}`);
  redirect(`/app/${encodeURIComponent(result.workspaceSlug)}`);
}

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const [preview, user] = await Promise.all([
    getInvitationPreview(token),
    getSessionUser(),
  ]);

  if (!preview) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg items-center px-4">
        <Card className="w-full">
          <CardContent className="space-y-3 p-6">
            <h1 className="text-lg font-semibold">Invitation not found</h1>
            <p className="text-sm text-muted-foreground">
              This link is invalid or has been replaced. Ask a workspace owner for a new invitation.
            </p>
            <Button asChild variant="outline">
              <Link href="/app">Go to Herald</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (preview.acceptedAt) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg items-center px-4">
        <Card className="w-full">
          <CardContent className="space-y-3 p-6">
            <h1 className="text-lg font-semibold">Invitation already used</h1>
            <p className="text-sm text-muted-foreground">
              This invitation has already been accepted.
            </p>
            <Button asChild>
              <Link href={`/app/${encodeURIComponent(preview.workspaceSlug)}`}>Open workspace</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-center px-4">
      <Card className="w-full">
        <CardContent className="space-y-5 p-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Herald invitation
            </p>
            <h1 className="mt-1 text-xl font-semibold">Join {preview.workspaceName}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              You were invited as <span className="font-medium">{preview.role}</span> with{" "}
              <span className="font-medium">{preview.email}</span>. This invitation expires{" "}
              {new Date(preview.expiresAt).toLocaleDateString("en", { dateStyle: "medium" })}.
            </p>
          </div>

          {error ? (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          {user ? (
            normalizedEmailsMatch(user.email, preview.email) ? (
              <>
                <p className="text-xs text-muted-foreground">
                  Signed in as <span className="font-medium text-foreground">{user.email}</span>.
                </p>
                <form action={accept}>
                  <input type="hidden" name="token" value={token} />
                  <Button type="submit" className="w-full">
                    Accept invitation
                  </Button>
                </form>
              </>
            ) : (
              <div className="space-y-3">
                <p
                  role="alert"
                  className="rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-sm text-warning"
                >
                  You are signed in as <span className="font-medium">{user.email}</span>, but
                  this invitation was sent to <span className="font-medium">{preview.email}</span>.
                  Sign out and sign back in with that address to accept it.
                </p>
                <SignOutButton label="Sign out and switch account" />
                <Button asChild variant="ghost" className="w-full">
                  <Link href={withRedirectParam("/sign-in", `/invite/${encodeURIComponent(token)}`)}>
                    Sign in with a different account
                  </Link>
                </Button>
              </div>
            )
          ) : (
            <div className="space-y-2">
              <Button asChild className="w-full">
                <Link href={withRedirectParam("/sign-in", `/invite/${encodeURIComponent(token)}`)}>
                  Sign in to accept
                </Link>
              </Button>
              <Button asChild variant="outline" className="w-full">
                <Link href={withRedirectParam("/sign-up", `/invite/${encodeURIComponent(token)}`)}>
                  Create an account
                </Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
