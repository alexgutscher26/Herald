"use client";

import { Archive, ArchiveRestore, ListPlus, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { toastUndoable } from "@/components/shared/action-toast";
import { EmptyState } from "@/components/shared/empty-state";
import { SettingsSection } from "@/components/shared/settings-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createCustomFieldAction,
  updateCustomFieldAction,
} from "@/features/feedback/custom-field-actions";
import type { CustomFieldDefinition, CustomFieldType } from "@/types";

/**
 * Custom field definitions for one product.
 *
 * The key and type are fixed at creation: filters and API clients address a
 * field by its key, and changing a type would silently reinterpret every
 * stored value. Archiving removes a field from the submit form while old
 * requests keep their values.
 */

const TYPE_LABELS: Record<CustomFieldType, string> = {
  text: "Text",
  number: "Number",
  select: "Select",
  date: "Date",
};

export function CustomFieldsView({
  workspaceSlug,
  productSlug,
  fields,
  canManage,
}: {
  workspaceSlug: string;
  productSlug: string;
  fields: CustomFieldDefinition[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [type, setType] = useState<CustomFieldType>("text");
  const [options, setOptions] = useState("");
  const [required, setRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startCreate] = useTransition();
  const [rowBusy, startRow] = useTransition();

  function create(event: FormEvent) {
    event.preventDefault();
    setError(null);
    startCreate(async () => {
      const result = await createCustomFieldAction({
        workspaceSlug,
        productSlug,
        label,
        type,
        options: options
          .split(",")
          .map((option) => option.trim())
          .filter(Boolean),
        required,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setLabel("");
      setOptions("");
      setRequired(false);
      router.refresh();
    });
  }

  function setArchived(field: CustomFieldDefinition, archived: boolean) {
    startRow(async () => {
      const result = await updateCustomFieldAction({
        workspaceSlug,
        productSlug,
        fieldId: field.id,
        archived,
      });
      if (!result.ok) {
        toast.error("Could not update that field", { description: result.error });
        return;
      }
      toastUndoable({
        message: archived ? `"${field.label}" archived` : `"${field.label}" restored`,
        description: archived
          ? "The field is hidden from new requests. Undo keeps it active."
          : "The field is active again for new requests.",
        onUndo: () => setArchived(field, !archived),
      });
      router.refresh();
    });
  }

  function toggleRequired(field: CustomFieldDefinition) {
    startRow(async () => {
      const result = await updateCustomFieldAction({
        workspaceSlug,
        productSlug,
        fieldId: field.id,
        required: !field.required,
      });
      if (!result.ok) {
        toast.error("Could not update that field", { description: result.error });
        return;
      }
      router.refresh();
    });
  }

  return (
    <SettingsSection
      id="custom-fields"
      icon={ListPlus}
      title="Custom fields"
      description="Typed details collected with every request on this product: filter and sort by them in the inbox, and read them through /api/v1."
    >
      {fields.length === 0 ? (
        <EmptyState
          compact
          icon={ListPlus}
          title="No custom fields yet"
          description="A request currently carries only its title, body, category and tags."
        />
      ) : (
        <ul className="divide-y rounded-md border">
          {fields.map((field) => (
            <li
              key={field.id}
              className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {field.label}
                  <Badge variant="secondary">{TYPE_LABELS[field.type]}</Badge>
                  {field.required ? <Badge variant="outline">Required</Badge> : null}
                  {field.archivedAt ? <Badge variant="outline">Archived</Badge> : null}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <code className="rounded bg-muted px-1 py-0.5">{field.key}</code>
                  {field.type === "select" && field.options.length > 0
                    ? ` · ${field.options.join(", ")}`
                    : ""}
                </p>
              </div>
              {canManage ? (
                <div className="flex flex-wrap items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={rowBusy}
                    onClick={() => toggleRequired(field)}
                  >
                    {field.required ? "Make optional" : "Make required"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={rowBusy}
                    onClick={() => setArchived(field, field.archivedAt === null)}
                  >
                    {field.archivedAt ? (
                      <>
                        <ArchiveRestore aria-hidden="true" />
                        Restore
                      </>
                    ) : (
                      <>
                        <Archive aria-hidden="true" />
                        Archive
                      </>
                    )}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <form onSubmit={create} className="space-y-3 rounded-md border bg-muted/20 p-3">
          <p className="text-sm font-medium">Add a field</p>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
            <div className="space-y-1.5">
              <Label htmlFor="custom-field-label">Label</Label>
              <Input
                id="custom-field-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                maxLength={80}
                placeholder="For example, Plan"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="custom-field-type">Type</Label>
              <Select
                value={type}
                onValueChange={(value) => setType(value as CustomFieldType)}
              >
                <SelectTrigger id="custom-field-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TYPE_LABELS) as CustomFieldType[]).map((value) => (
                    <SelectItem key={value} value={value}>
                      {TYPE_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {type === "select" ? (
            <div className="space-y-1.5">
              <Label htmlFor="custom-field-options">Options</Label>
              <Input
                id="custom-field-options"
                value={options}
                onChange={(event) => setOptions(event.target.value)}
                placeholder="Free, Starter, Professional"
              />
              <p className="text-[11px] text-muted-foreground">
                Comma-separated. Each option becomes a filter value in the inbox and API.
              </p>
            </div>
          ) : null}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={required}
              onChange={(event) => setRequired(event.target.checked)}
              className="size-4 accent-primary"
            />
            Required on every new submission
          </label>

          {error ? (
            <p role="alert" className="text-xs font-medium text-destructive">
              {error}
            </p>
          ) : null}

          <Button type="submit" size="sm" disabled={pending || label.trim() === ""}>
            <Plus aria-hidden="true" />
            {pending ? "Adding…" : "Add field"}
          </Button>
        </form>
      ) : (
        <p className="text-xs text-muted-foreground">
          Only owners and admins can change the fields.
        </p>
      )}
    </SettingsSection>
  );
}
