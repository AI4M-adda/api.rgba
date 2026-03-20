import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import type { Database } from "@rgba/db"
import * as authSchema from "@rgba/db/schema/auth"
import { createConsoleEmailService } from "./email"

export function createAuth(env: {
  db: Database
  baseURL: string
  secret: string
  trustedOrigins: string[]
  cookieDomain?: string
  googleClientId?: string
  googleClientSecret?: string
  accountAppUrl: string
}) {
  const emailService = createConsoleEmailService()

  const schema = {
    user: authSchema.users,
    session: authSchema.sessions,
    account: authSchema.accounts,
    verification: authSchema.verifications,
  }

  return betterAuth({
    database: drizzleAdapter(env.db, { provider: "pg", schema }),
    baseURL: env.baseURL,
    secret: env.secret,
    trustedOrigins: env.trustedOrigins,
    emailAndPassword: {
      enabled: true,
      sendResetPassword: async ({ user, token }) => {
        const resetUrl = `${env.accountAppUrl}/reset-password?token=${token}`
        await emailService.send({
          to: user.email,
          subject: "Reset your RGBA password",
          html: `<h2>Password Reset</h2>
<p>Hi ${user.name},</p>
<p>Click the link below to reset your password:</p>
<p><a href="${resetUrl}">${resetUrl}</a></p>
<p>This link expires in 1 hour.</p>
<p>If you didn't request this, ignore this email.</p>`,
        })
      },
      resetPasswordTokenExpiresIn: 3600,
      revokeSessionsOnPasswordReset: true,
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, token }) => {
        const verifyUrl = `${env.accountAppUrl}/verify-email?token=${token}`
        await emailService.send({
          to: user.email,
          subject: "Verify your RGBA email",
          html: `<h2>Email Verification</h2>
<p>Hi ${user.name},</p>
<p>Click the link below to verify your email:</p>
<p><a href="${verifyUrl}">${verifyUrl}</a></p>
<p>This link expires in 24 hours.</p>`,
        })
      },
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 86400,
    },
    socialProviders:
      env.googleClientId && env.googleClientSecret
        ? {
            google: {
              clientId: env.googleClientId,
              clientSecret: env.googleClientSecret,
            },
          }
        : {},
    advanced: {
      // Cross-subdomain SSO: cookie shared across *.rgba.dev
      crossSubDomainCookies: {
        enabled: !!env.cookieDomain,
        domain: env.cookieDomain ?? "",
      },
      // Cookie-based sessions only — no bearer tokens, no localStorage
      cookiePrefix: "rgba-auth",
      // Database uses uuid columns — generate UUIDs for IDs
      database: { generateId: "uuid" },
    },
    session: {
      // Sessions stored in database + HTTP-only cookie holds session token
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // Refresh session every 24h
      // Cookie config: httpOnly + secure + sameSite=lax (Better Auth defaults)
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5, // Cache session in cookie for 5 min to reduce DB lookups
      },
    },
  })
}
