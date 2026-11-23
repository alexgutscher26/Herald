"use client";

import { Package } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toastActionFailure } from "@/components/shared/action-toast";

import { SettingsSection } from "@/components/shared/settings-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { saveProductDetailsAction } from "./actions";
import {
  PRODUCT_DESCRIPTION_MAX,
  PRODUCT_DESCRIPTION_MIN,
} from "./constants";

export function ProductDetailsView({
  workspaceSlug,
  productSlug,
  productName,
  initialDescription,
  updatedAt,
  canManage,
}: {
  workspaceSlug: string;
  productSlug: string;
  productName: string;
  initialDescription: string;
  updatedAt: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [description, setDescription] = useState(initialDescription);
  const [savedDescription, setSavedDescription] = useState(initialDescription);
  const [saving, startSave] = useTransition();

  function save() {
    startSave(async () => {
      const result = await saveProductDetailsAction({
        workspaceSlug,
        productSlug,
        description,
      });

      if (!result.ok) {
        toastActionFailure(result);
        return;
      }

      setDescription(result.data.description);
      setSavedDescription(result.data.description);
      router.refresh();
    });
  }

  const dirty = description.trim() !== savedDescription.trim();

  return (
    <SettingsSection
      id="product-details"
      icon={Package}
      title="Product details"
      description={`The name customers see and the one-line summary used on ${productName}'s public changelog, roadmap and widget.`}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {updatedAt
              ? `Last saved ${new Date(updatedAt).toLocaleString("en")}.`
              : "Not saved yet."}
          </span>
          <Button
            type="button"
            onClick={save}
            disabled={!canManage || saving || !dirty}
          >
            {saving ? "Saving…" : "Save details"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="product-name">Product name</Label>
          <Input
            id="product-name"
            value={productName}
            readOnly
            aria-describedby="product-name-hint"
          />
          <p
            id="product-name-hint"
            className="text-xs text-muted-foreground"
          >
            Set when the product was created.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="product-description">Description</Label>
          <Textarea
            id="product-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={PRODUCT_DESCRIPTION_MAX}
            rows={3}
            placeholder={`Describe ${productName} in a sentence.`}
            disabled={!canManage}
            aria-describedby="product-description-hint"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p
              id="product-description-hint"
              className="text-xs leading-5 text-muted-foreground"
            >
              At least {PRODUCT_DESCRIPTION_MIN} characters, or leave blank.
              Shown on the public changelog, roadmap and widget.
            </p>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {description.length}/{PRODUCT_DESCRIPTION_MAX}
            </span>
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
