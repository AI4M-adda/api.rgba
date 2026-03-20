import { Hono } from "hono"
import { createDb } from "@rgba/db"
import { createAuth } from "./auth"
import { createCorsMiddleware } from "./middleware/cors"
import { sessionMiddleware } from "./middleware/session"
import { createRpcRoutes } from "./routes"

type Env = {
  Bindings: {
    DATABASE_URL: string
    BETTER_AUTH_SECRET: string
    API_BASE_URL: string
    ACCOUNT_APP_URL: string
    STUDIO_APP_URL: string
    COOKIE_DOMAIN?: string
    GOOGLE_CLIENT_ID?: string
    GOOGLE_CLIENT_SECRET?: string
  }
}

const app = new Hono<Env>()

function getTrustedOrigins(c: { env: Env["Bindings"] }): string[] {
  return [c.env.ACCOUNT_APP_URL, c.env.STUDIO_APP_URL].filter(Boolean)
}

// Global CORS — handles OPTIONS preflight for all routes
app.use("*", async (c, next) => {
  const corsMiddleware = createCorsMiddleware(getTrustedOrigins(c))
  return corsMiddleware(c, next)
})

// Better Auth handler — explicit CORS on response (auth.handler returns new Response)
app.all("/api/auth/**", async (c) => {
  const trustedOrigins = getTrustedOrigins(c)
  const origin = c.req.header("origin")
  const isAllowed = !!origin && trustedOrigins.includes(origin)

  // Handle OPTIONS preflight
  if (c.req.method === "OPTIONS") {
    c.status(204)
    if (isAllowed) {
      c.header("Access-Control-Allow-Origin", origin)
      c.header("Access-Control-Allow-Credentials", "true")
    }
    c.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
    c.header("Access-Control-Allow-Headers", "Content-Type,Authorization")
    c.header("Access-Control-Max-Age", "86400")
    c.header("Vary", "Origin")
    return c.body(null)
  }

  const db = createDb(c.env.DATABASE_URL)
  const auth = createAuth({
    db,
    baseURL: c.env.API_BASE_URL,
    secret: c.env.BETTER_AUTH_SECRET,
    trustedOrigins,
    cookieDomain: c.env.COOKIE_DOMAIN,
    googleClientId: c.env.GOOGLE_CLIENT_ID,
    googleClientSecret: c.env.GOOGLE_CLIENT_SECRET,
    accountAppUrl: c.env.ACCOUNT_APP_URL,
  })
  const response = await auth.handler(c.req.raw)

  // Merge CORS headers onto Better Auth's response
  if (isAllowed) {
    response.headers.set("Access-Control-Allow-Origin", origin)
    response.headers.set("Access-Control-Allow-Credentials", "true")
    response.headers.set("Vary", "Origin")
  }
  return response
})

// Session middleware for protected RPC routes
app.use("/api/rpc/*", async (c, next) => {
  const db = createDb(c.env.DATABASE_URL)
  const auth = createAuth({
    db,
    baseURL: c.env.API_BASE_URL,
    secret: c.env.BETTER_AUTH_SECRET,
    trustedOrigins: getTrustedOrigins(c),
    cookieDomain: c.env.COOKIE_DOMAIN,
    googleClientId: c.env.GOOGLE_CLIENT_ID,
    googleClientSecret: c.env.GOOGLE_CLIENT_SECRET,
    accountAppUrl: c.env.ACCOUNT_APP_URL,
  })
  return sessionMiddleware(auth)(c, next)
})

// Mount RPC routes
const rpcRoutes = createRpcRoutes()
app.route("/api/rpc", rpcRoutes)

// Debug endpoint — verify env vars (remove in production)
app.get("/debug/cors", (c) => {
  return c.json({
    ACCOUNT_APP_URL: c.env.ACCOUNT_APP_URL ?? "NOT SET",
    STUDIO_APP_URL: c.env.STUDIO_APP_URL ?? "NOT SET",
    API_BASE_URL: c.env.API_BASE_URL ?? "NOT SET",
  })
})

// Health check
app.get("/", (c) => {
  return c.json({ status: "ok", service: "api.rgba" })
})

export default app
