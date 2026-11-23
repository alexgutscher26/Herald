"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CustomFieldDefinition } from "@/types";

/**
 * Inputs for a product's typed custom fields.
 *
 * Shared by the public submit form and the dashboard request editor so both
 * collect exactly the same shape. Values travel as strings and are coerced on
 * the server by `parseCustomFieldValues`; the browser never decides validity
 * beyond `required` and input type hints.
 */

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50";

export type CustomFieldInputValues = Record<string, string>;

/** The subset both a dashboard definition and a public field payload provide. */
export type CustomFieldInput = Pick<
  CustomFieldDefinition,
  "id" | "key" | "label" | "description" | "type" | "options" | "required"
>;

export function CustomFieldInputs({
  fields,
  values,
  onChange,
  errors,
  idPrefix,
  disabled = false,
  className,
}: {
  fields: readonly CustomFieldInput[];
  values: CustomFieldInputValues;
  onChange: (key: string, value: string) => void;
  errors?: Record<string, string>;
  idPrefix: string;
  disabled?: boolean;
  className?: string;
}) {
  if (fields.length === 0) return null;

  return (
    <div className={className ?? "space-y-3"}>
      {fields.map((field) => {
        const id = `${idPrefix}-${field.key}`;
        const error = errors?.[field.key];
        const describedBy = [
          field.description ? `${id}-help` : null,
          error ? `${id}-error` : null,
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <div key={field.id} className="space-y-1.5">
            <Label htmlFor={id}>
              {field.label}
              {field.required ? (
                <span className="ml-1 text-destructive" aria-hidden="true">
                  *
                </span>
              ) : (
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  optional
                </span>
              )}
            </Label>

            {field.type === "select" ? (
              <select
                id={id}
                value={values[field.key] ?? ""}
                onChange={(event) => onChange(field.key, event.target.value)}
                disabled={disabled}
                required={field.required}
                aria-invalid={Boolean(error)}
                aria-describedby={describedBy || undefined}
                className={SELECT_CLASS}
              >
                <option value="">{field.required ? "Choose an option" : "Not set"}</option>
                {field.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id={id}
                type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                value={values[field.key] ?? ""}
                onChange={(event) => onChange(field.key, event.target.value)}
                disabled={disabled}
                required={field.required}
                maxLength={field.type === "text" ? 2_000 : undefined}
                step={field.type === "number" ? "any" : undefined}
                aria-invalid={Boolean(error)}
                aria-describedby={describedBy || undefined}
              />
            )}

            {field.description ? (
              <p id={`${id}-help`} className="text-xs text-muted-foreground">
                {field.description}
              </p>
            ) : null}
            {error ? (
              <p id={`${id}-error`} role="alert" className="text-xs font-medium text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
