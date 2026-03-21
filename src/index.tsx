import { Hono } from "hono"
import { createDb } from "@rgba/db"
import { createAuth } from "./auth"
import { createCorsMiddleware } from "./middleware/cors"
import { sessionMiddleware } from "./middleware/session"
import { userRoutes } from "./routes/user"
import { memoRoutes } from "./routes/studio/memo"
import { electricProxy } from "./routes/studio/electric-proxy"
import { marketRoutes } from "./routes/market"
import { watchlistRoutes } from "./routes/trading/watchlist"
import { marketPreferencesRoutes } from "./routes/trading/market-preferences"

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
    ELECTRIC_URL?: string
    ELECTRIC_ID?: string
    ELECTRIC_SECRET?: string
    TRADING_APP_URL?: string
    MSTOCK_API_KEY: string
    MSTOCK_API_SECRET: string
    MSTOCK_TOTP_SECRET?: string
  }
}

const app = new Hono<Env>()

function getTrustedOrigins(c: { env: Env["Bindings"] }): string[] {
  return [c.env.ACCOUNT_APP_URL, c.env.STUDIO_APP_URL, c.env.TRADING_APP_URL].filter((v): v is string => Boolean(v))
}

// Request logging (dev only)
app.use("*", async (c, next) => {
  console.log(`[api] ${c.req.method} ${c.req.path}`)
  await next()
  console.log(`[api] ${c.req.method} ${c.req.path} → ${c.res.status}`)
})

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
    c.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
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

// Session middleware for protected routes (RPC + shapes)
app.use("/api/rpc/*", async (c, next) => {
  const cookie = c.req.header("cookie") ?? ""
  if (!cookie) {
    return c.json({ error: "Unauthorized" }, 401)
  }

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

// Session middleware for Electric shape proxy
app.use("/api/shapes/*", async (c, next) => {
  const cookie = c.req.header("cookie") ?? ""
  if (!cookie) {
    return c.json({ error: "Unauthorized" }, 401)
  }

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

// Mount RPC routes directly (avoid double-nested .route() path issues)
app.get("/api/rpc/ping", (c) => c.json({ pong: true }))
app.route("/api/rpc/user", userRoutes)
app.route("/api/rpc/memo", memoRoutes)
app.route("/api/rpc/market", marketRoutes)
app.route("/api/rpc/watchlist", watchlistRoutes)
app.route("/api/rpc/market-preferences", marketPreferencesRoutes)

// Mount Electric shape proxy (authenticated)
app.route("/api/shapes", electricProxy)

// Health check
app.get("/", (c) => {
  return c.json({ status: "ok", service: "api.rgba" })
})

// Global error handler
app.onError((err, c) => {
  console.error(`[api] Error on ${c.req.method} ${c.req.path}:`, err.message, err.stack)
  return c.json({ error: err.message, path: c.req.path }, 500)
})

// Not found handler — log the path for debugging
app.notFound((c) => {
  console.error(`[api] 404 Not Found: ${c.req.method} ${c.req.path}`)
  return c.json({ error: "Not Found", path: c.req.path, method: c.req.method }, 404)
})

export default app
