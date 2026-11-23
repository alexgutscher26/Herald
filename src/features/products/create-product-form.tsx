"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createProductAction } from "@/features/products/actions";
import { slugify } from "@/lib/slug";

/**
 * Create a product from workspace settings.
 *
 * The server re-checks `product:create` and the plan's product allowance, so
 * this form only supplies the name and slug. The slug is derived from the name
 * until the operator edits it by hand, matching the onboarding form.
 */
export function CreateProductForm({ workspaceSlug }: { workspaceSlug: string }) {
  const router = useRouter();
  const nameId = useId();
  const slugId = useId();
  const [name, setName] = useState("");
  const [editedSlug, setEditedSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [billingUrl, setBillingUrl] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  // Derived during render rather than synced in an effect: the slug follows the
  // name until the operator edits it, then it is theirs.
  const slug = slugEdited ? editedSlug : slugify(name);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBillingUrl(null);
    setFieldErrors({});
    setPending(true);

    try {
      const result = await createProductAction({ workspaceSlug, name, slug });
      if (!result.ok) {
        setError(result.error);
        setBillingUrl(result.billingUrl ?? null);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }

      setName("");
      setEditedSlug("");
      setSlugEdited(false);
      router.push(result.data.redirectTo);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-border/80 bg-muted/20 p-4">
      <div>
        <p className="text-sm font-medium">New product</p>
        <p className="text-xs text-muted-foreground">
          It starts with one public Feedback board. Boards, branding and domain are configured per
          product.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={nameId}>Product name</Label>
          <Input
            id={nameId}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Mobile app"
            maxLength={80}
            disabled={pending}
            aria-invalid={Boolean(fieldErrors.name)}
          />
          {fieldErrors.name ? (
            <p className="text-xs text-destructive">{fieldErrors.name[0]}</p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={slugId}>Product URL</Label>
          <Input
            id={slugId}
            value={slug}
            onChange={(event) => {
              setSlugEdited(true);
              setEditedSlug(event.target.value);
            }}
            placeholder="mobile-app"
            maxLength={48}
            disabled={pending}
            aria-invalid={Boolean(fieldErrors.slug)}
          />
          {fieldErrors.slug ? (
            <p className="text-xs text-destructive">{fieldErrors.slug[0]}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Lowercase letters, numbers and hyphens. Unique in this workspace.
            </p>
          )}
        </div>
      </div>

      {error && !fieldErrors.slug && !fieldErrors.name ? (
        <p className="text-xs text-destructive">
          {error}
          {billingUrl ? (
            <>
              {" "}
              <a className="font-medium underline" href={billingUrl}>
                Compare plans
              </a>
            </>
          ) : null}
        </p>
      ) : null}

      <Button type="submit" size="sm" disabled={pending || name.trim().length < 2 || slug.length < 3}>
        {pending ? "Creating…" : "Create product"}
        {pending ? null : <ArrowRight aria-hidden="true" />}
      </Button>
    </form>
  );
}
