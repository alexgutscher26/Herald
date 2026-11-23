import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { sso } from "@better-auth/sso";

import * as schema from "@/db/schema";
import { db } from "@/db";
import { recordAccountCreated } from "@/features/analytics/signup-funnel";
import { AUTH_RATE_LIMIT_RULES, authRateLimitStorage } from "@/features/auth/rate-limit";
import { PASSWORD_RESET_TTL_SECONDS } from "@/features/auth/reset-token";
import { replaceWithHashedResetToken } from "@/features/auth/reset-token-store";
import { isAuthEmailConfigured, sendAuthEmail } from "@/features/email/auth-mail";
import { joinVerifiedDomainWorkspaces } from "@/features/workspace-settings/domain-capture";
import {
  renderEmailChangeConfirmationEmail,
  renderEmailVerificationEmail,
  renderPasswordChangedEmail,
  renderPasswordResetEmail,
} from "@/features/email/templates";
import { publicOrigin } from "@/features/public/urls";
import { getServerEnv } from "@/lib/env";
import { logEvent, serializeError } from "@/lib/logger";

/**
 * Server-side Better Auth instance.
 *
 * Created on first use rather than at module evaluation: Next.js imports
 * route modules while building, and reading `DATABASE_URL` /
 * `BETTER_AUTH_SECRET` at that point would turn a missing local variable into
 * a build failure. `getAuth()` is always called from inside a request handler
 * or server action, so a missing value surfaces as a clear error at the exact
 * place it matters.
 *
 * Driver/adapter notes:
 *  - Drizzle adapter with `provider: "pg"` and `transaction: true`, because
 *    the underlying `pg` driver holds a connection across BEGIN/COMMIT.
 *  - `schema` must expose the Drizzle tables under the export names `user`,
 *    `session`, `account` and `verification` (see `src/db/schema/auth.ts`).
 *  - `nextCookies()` must be the last plugin so it can persist the session
 *    cookie from the route handler response.
 */

/** Verification links live for one hour, matching the email copy. */
const EMAIL_VERIFICATION_TTL_SECONDS = 60 * 60;

function createAuth(env: ReturnType<typeof getServerEnv>) {
  const origin = publicOrigin();

  // Verification is enforced only when an email provider can actually deliver
  // the link: requiring it without one would create accounts nobody can
  // activate. A half-configured provider logs an error and leaves the gate off
  // rather than taking authentication down (see `isAuthEmailConfigured`).
  const emailDelivery = isAuthEmailConfigured();

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema,
      // Multi-statement units of work (sign-up creates a user, account and
      // session) are wrapped in a real transaction.
      transaction: true,
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      // An unverified address cannot sign in with a password: sessions are only
      // issued after the emailed link is opened.
      requireEmailVerification: emailDelivery,
      resetPasswordTokenExpiresIn: PASSWORD_RESET_TTL_SECONDS,
      // A reset is what someone does when they think the password leaked, so
      // every existing session is revoked with the password write.
      revokeSessionsOnPasswordReset: true,
      /**
       * Better Auth has already written `reset-password:<token>` in plain text
       * at this point. Replace it with a hashed row, then email our own link —
       * the token is only meaningful while it sits in the message.
       */
      sendResetPassword: async ({ user, token }) => {
        try {
          await replaceWithHashedResetToken({
            userId: user.id,
            rawToken: token,
            expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_SECONDS * 1000),
          });
        } catch (error) {
          // Nothing was stored, so there is no link worth sending.
          logEvent("error", "auth.password_reset_token_failed", {
            error: serializeError(error),
          });
          return;
        }

        await sendAuthEmail({
          to: user.email,
          event: "auth.password_reset",
          email: renderPasswordResetEmail({
            name: user.name,
            url: `${origin}/reset-password?token=${encodeURIComponent(token)}`,
            expiresMinutes: PASSWORD_RESET_TTL_SECONDS / 60,
          }),
        });
      },
      /** Sent after the password write and the session revocation commit. */
      onPasswordReset: async ({ user }) => {
        await sendAuthEmail({
          to: user.email,
          event: "auth.password_changed",
          email: renderPasswordChangedEmail({
            name: user.name,
            email: user.email,
            signInUrl: `${origin}/sign-in`,
          }),
        });
      },
    },
    emailVerification: {
      sendOnSignUp: emailDelivery,
      // Opening the link signs the account in, so sign-up continues straight to
      // the dashboard instead of bouncing through the sign-in form again.
      autoSignInAfterVerification: true,
      expiresIn: EMAIL_VERIFICATION_TTL_SECONDS,
      sendVerificationEmail: async ({ user, url }) => {
        await sendAuthEmail({
          to: user.email,
          event: "auth.email_verification",
          email: renderEmailVerificationEmail({
            name: user.name,
            url,
            expiresMinutes: EMAIL_VERIFICATION_TTL_SECONDS / 60,
          }),
        });
      },
    },
    /**
     * Request throttling for every `/api/auth/*` path.
     *
     * Enabled unconditionally (the library default is production-only) and
     * counted in Postgres through `authRateLimitStorage`, so a lockout holds
     * across serverless instances. The rules below are the tuning: sign-in and
     * the mail-sending endpoints are far tighter than the 60s/100 baseline.
     */
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: AUTH_RATE_LIMIT_RULES,
      customStorage: authRateLimitStorage,
    },
    user: {
      changeEmail: {
        // Two-step by design: confirm from the current inbox, then verify the
        // new address. The address only changes after the second link.
        enabled: emailDelivery,
        sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
          await sendAuthEmail({
            to: user.email,
            event: "auth.email_change",
            email: renderEmailChangeConfirmationEmail({
              name: user.name,
              currentEmail: user.email,
              newEmail,
              url,
              expiresMinutes: EMAIL_VERIFICATION_TTL_SECONDS / 60,
            }),
          });
        },
      },
      deleteUser: {
        // The workspace-ownership guard runs before this endpoint is called
        // (see `src/features/account/actions.ts`); the password is always sent.
        enabled: true,
      },
    },
    databaseHooks: {
      user: {
        create: {
          /**
           * Domain capture: a workspace that has verified a claim for this
           * address's domain gets the new member automatically. It runs after
           * the account exists, and `joinVerifiedDomainWorkspaces` swallows its
           * own failures — a capture must never fail a sign-up.
           */
          after: async (created) => {
            if (!created?.id || !created.email) return;
            await joinVerifiedDomainWorkspaces({
              userId: created.id,
              email: created.email,
            });
            await recordAccountCreated(created.id);
          },
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    telemetry: { enabled: false },
    plugins: [
      // Enterprise SAML/OIDC. Providers are registered per workspace by an
      // owner/admin through the authenticated settings action; the plugin owns
      // assertion validation, replay protection and session creation.
      sso({
        saml: {
          enableInResponseToValidation: true,
          allowIdpInitiated: true,
          clockSkew: 60_000,
          requireTimestamps: true,
        },
      }),
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

let instance: Auth | null = null;

export function getAuth(): Auth {
  if (instance) return instance;

  const created = createAuth(getServerEnv());
  instance = created;
  return created;
}