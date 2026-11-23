"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

/**
 * Sign out from a server-rendered page.
 *
 * Used on the invitation page when the session belongs to a different address
 * than the invitation: the only way forward there is to sign out and come back
 * with the right account, so the option has to be on that page.
 */
export function SignOutButton({ label = "Sign out" }: { label?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    await authClient.signOut().catch(() => null);
    setPending(false);
    router.refresh();
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      onClick={() => void signOut()}
      disabled={pending}
    >
      {pending ? "Signing out…" : label}
    </Button>
  );
}
