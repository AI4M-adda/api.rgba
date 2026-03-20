import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import type { Database } from "@rgba/db"

export function createAuth(env: {
  db: Database
  baseURL: string
  secret: string
  trustedOrigins: string[]
  cookieDomain?: string
  googleClientId?: string
  googleClientSecret?: string
}) {
  return betterAuth({
    database: drizzleAdapter(env.db, { provider: "pg" }),
    baseURL: env.baseURL,
    secret: env.secret,
    trustedOrigins: env.trustedOrigins,
    emailAndPassword: { enabled: true },
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
