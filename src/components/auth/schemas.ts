import { z } from "zod";

import { isValidEmail } from "@/lib/email";

/**
 * Client-facing form validation for sign-in and sign-up.
 *
 * Email validation reuses the application's single canonical checker so the
 * form and the database agree on what an address is. Better Auth re-validates
 * everything server-side — these schemas only improve feedback.
 */

const emailField = z
  .string()
  .min(1, "Email is required.")
  .refine((value) => isValidEmail(value), "Enter a valid email address.");

export const signInSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Password is required."),
});

export type SignInValues = z.infer<typeof signInSchema>;

export const signUpSchema = z.object({
  name: z.string().min(1, "Name is required.").max(80, "Name must be 80 characters or fewer."),
  email: emailField,
  password: z
    .string()
    .min(10, "Use at least 10 characters.")
    .max(128, "Password must be 128 characters or fewer."),
});

export type SignUpValues = z.infer<typeof signUpSchema>;

/** Flatten a Zod v4 issue map into `field -> message`. */
export function flattenFieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!result[key]) result[key] = issue.message;
  }
  return result;
}