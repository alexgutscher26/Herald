"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { createWorkspaceWithProductAction } from "@/features/onboarding/actions";
import { onboardingSchema, type OnboardingValues } from "@/features/onboarding/schema";
import { slugify } from "@/lib/slug";

type OnboardingFormProps = {
  /** Shown when the user already has workspaces (e.g. creating a second one). */
  existingWorkspaceCount: number;
  /** Arrived from the pricing page's Founding Lifetime CTA. */
  offerLifetime?: boolean;
};

export function OnboardingForm({
  existingWorkspaceCount,
  offerLifetime = false,
}: OnboardingFormProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<OnboardingValues>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      workspaceName: "",
      workspaceSlug: "",
      productName: "",
      productSlug: "",
      offerLifetime,
    },
    mode: "onSubmit",
  });

  const workspaceName = useWatch({ control: form.control, name: "workspaceName" });
  const productName = useWatch({ control: form.control, name: "productName" });

  // Derive URL slugs from names until the user edits them by hand.
  useEffect(() => {
    if (!form.formState.dirtyFields.workspaceSlug) {
      form.setValue("workspaceSlug", slugify(workspaceName ?? ""), { shouldValidate: false });
    }
  }, [workspaceName, form]);

  useEffect(() => {
    if (!form.formState.dirtyFields.productSlug) {
      form.setValue("productSlug", slugify(productName ?? ""), { shouldValidate: false });
    }
  }, [productName, form]);

  async function onSubmit(values: OnboardingValues) {
    setFormError(null);
    setIsSubmitting(true);

    try {
      const result = await createWorkspaceWithProductAction(values);

      if (result.ok && result.redirectTo) {
        router.replace(result.redirectTo);
        router.refresh();
        return;
      }

      if (result.formError) setFormError(result.formError);

      for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
        if (field === "form") {
          setFormError(message);
          continue;
        }
        form.setError(field as keyof OnboardingValues, { message });
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
        {formError ? (
          <Alert variant="destructive">
            <AlertTitle>Could not finish setup</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold">Your workspace</h2>
            <p className="text-sm text-muted-foreground">
              A workspace owns your team, billing and products.
            </p>
          </div>

          <FormField
            control={form.control}
            name="workspaceName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Workspace name</FormLabel>
                <FormControl>
                  <Input placeholder="Acme Inc." disabled={isSubmitting} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="workspaceSlug"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Workspace URL</FormLabel>
                <FormControl>
                  <Input placeholder="acme-inc" disabled={isSubmitting} {...field} />
                </FormControl>
                <FormDescription>Lowercase letters, numbers and hyphens.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        <section className="space-y-4 border-t pt-6">
          <div>
            <h2 className="text-sm font-semibold">Your first product</h2>
            <p className="text-sm text-muted-foreground">
              Releases, feedback and roadmaps all belong to a product.
            </p>
          </div>

          <FormField
            control={form.control}
            name="productName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Product name</FormLabel>
                <FormControl>
                  <Input placeholder="Changelog Widget" disabled={isSubmitting} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="productSlug"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Product URL</FormLabel>
                <FormControl>
                  <Input placeholder="changelog-widget" disabled={isSubmitting} {...field} />
                </FormControl>
                <FormDescription>Unique inside this workspace.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? (
            "Creating workspace…"
          ) : (
            <>
              {existingWorkspaceCount > 0 ? "Create workspace" : "Create workspace and continue"}
              <ArrowRight aria-hidden="true" />
            </>
          )}
        </Button>
      </form>
    </Form>
  );
}