import { z } from "zod";

import { PASSWORD_RESET_MAX_LENGTH, PASSWORD_RESET_MIN_LENGTH } from "@/features/auth/reset-token";
import { isValidEmail } from "@/lib/email";

/**
 * Validation for the account flows around sign-in: requesting a reset,
 * completing one, and changing a password while signed in.
 *
 * The password bounds mirror `emailAndPassword` in `src/lib/auth.ts`, so the
 * form rejects a value the server would refuse instead of spending a
 * single-use reset token on it.
 */

const emailField = z
  .string()
  .min(1, "Email is required.")
  .refine((value) => isValidEmail(value), "Enter a valid email address.");

const passwordField = z
  .string()
  .min(
    PASSWORD_RESET_MIN_LENGTH,
    `Use at least ${PASSWORD_RESET_MIN_LENGTH} characters.`,
  )
  .max(
    PASSWORD_RESET_MAX_LENGTH,
    `Use ${PASSWORD_RESET_MAX_LENGTH} characters or fewer.`,
  );

export const forgotPasswordSchema = z.object({
  email: emailField,
});

export const changeEmailSchema = z.object({
  email: emailField,
});

export type ChangeEmailValues = z.infer<typeof changeEmailSchema>;

export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    password: passwordField,
    confirmPassword: z.string().min(1, "Repeat the new password."),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "The passwords do not match.",
    path: ["confirmPassword"],
  });

export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: passwordField,
    confirmPassword: z.string().min(1, "Repeat the new password."),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: "The passwords do not match.",
    path: ["confirmPassword"],
  })
  .refine((values) => values.newPassword !== values.currentPassword, {
    message: "Choose a password different from the current one.",
    path: ["newPassword"],
  });

export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;
