import { redirect } from "next/navigation";

import { SignInForm } from "@/components/auth/sign-in-form";
import { getSessionUser } from "@/lib/authz";
import { safePostAuthRedirect } from "@/lib/redirect";

export const metadata = {
  title: "Sign in",
};

type SignInPageProps = {
  searchParams: Promise<{ redirect?: string }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = await searchParams;
  const redirectTo = safePostAuthRedirect(params.redirect);

  // Already signed in? Go straight to the requested (validated) destination.
  const user = await getSessionUser();
  if (user) redirect(redirectTo);

  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <div className="mb-6 space-y-1.5">
        <h1 className="text-lg font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          Sign in to manage your changelog, feedback and roadmaps.
        </p>
      </div>
      <SignInForm redirectTo={redirectTo} />
    </div>
  );
}