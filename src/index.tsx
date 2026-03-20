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

// CORS — must be BEFORE auth routes
app.use("*", async (c, next) => {
  const trustedOrigins = [
    c.env.ACCOUNT_APP_URL,
    c.env.STUDIO_APP_URL,
  ].filter(Boolean)
  const corsMiddleware = createCorsMiddleware(trustedOrigins)
  return corsMiddleware(c, next)
})

// Better Auth handler — catches all /api/auth/* routes
app.on(["POST", "GET"], "/api/auth/**", async (c) => {
  const db = createDb(c.env.DATABASE_URL)
  const auth = createAuth({
    db,
    baseURL: c.env.API_BASE_URL,
    secret: c.env.BETTER_AUTH_SECRET,
    trustedOrigins: [c.env.ACCOUNT_APP_URL, c.env.STUDIO_APP_URL].filter(
      Boolean
    ),
    cookieDomain: c.env.COOKIE_DOMAIN,
    googleClientId: c.env.GOOGLE_CLIENT_ID,
    googleClientSecret: c.env.GOOGLE_CLIENT_SECRET,
  })
  return auth.handler(c.req.raw)
})

// Session middleware for protected RPC routes
app.use("/api/rpc/*", async (c, next) => {
  const db = createDb(c.env.DATABASE_URL)
  const auth = createAuth({
    db,
    baseURL: c.env.API_BASE_URL,
    secret: c.env.BETTER_AUTH_SECRET,
    trustedOrigins: [c.env.ACCOUNT_APP_URL, c.env.STUDIO_APP_URL].filter(
      Boolean
    ),
    cookieDomain: c.env.COOKIE_DOMAIN,
    googleClientId: c.env.GOOGLE_CLIENT_ID,
    googleClientSecret: c.env.GOOGLE_CLIENT_SECRET,
  })
  return sessionMiddleware(auth)(c, next)
})

// Mount RPC routes
const rpcRoutes = createRpcRoutes()
app.route("/api/rpc", rpcRoutes)

// Health check
app.get("/", (c) => {
  return c.json({ status: "ok", service: "api.rgba" })
})

export default app
