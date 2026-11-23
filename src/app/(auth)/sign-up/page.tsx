import { redirect } from "next/navigation";

import { SignUpForm } from "@/components/auth/sign-up-form";
import { trackSignUpPageView } from "@/features/analytics/signup-funnel";
import { getSessionUser } from "@/lib/authz";
import { safePostAuthRedirect } from "@/lib/redirect";

export const metadata = {
  title: "Create account",
};

type SignUpPageProps = {
  searchParams: Promise<{ redirect?: string; offer?: string }>;
};

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const params = await searchParams;
  const redirectTo = safePostAuthRedirect(
    params.redirect ??
      (params.offer === "lifetime" ? "/app/onboarding?offer=lifetime" : undefined),
  );

  const user = await getSessionUser();
  if (user) redirect(redirectTo);

  await trackSignUpPageView();

  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <div className="mb-6 space-y-1.5">
        <h1 className="text-lg font-semibold tracking-tight">Create your account</h1>
        <p className="text-sm text-muted-foreground">
          You will create your workspace and first product right after signing up.
        </p>
      </div>
      <SignUpForm redirectTo={redirectTo} />
    </div>
  );
}