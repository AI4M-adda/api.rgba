import { Hono } from "hono"

type Env = {
  Bindings: {
    ELECTRIC_URL: string
    ELECTRIC_ID: string
    ELECTRIC_SECRET: string
  }
  Variables: {
    user: { id: string; name: string; email: string }
    session: unknown
  }
}

export const electricProxy = new Hono<Env>()

// Proxy shape requests to Electric, scoped to the authenticated user
electricProxy.get("/", async (c) => {
  const electricUrl = c.env.ELECTRIC_URL
  if (!electricUrl) {
    return c.json({ error: "Electric service not configured" }, 503)
  }

  const user = c.get("user")
  const url = new URL(c.req.url)

  // Build Electric shape URL with user scoping
  const shapeUrl = new URL("/v1/shape", electricUrl)

  // Forward all query params from client
  for (const [key, value] of url.searchParams.entries()) {
    // Don't let client override the where clause for security
    if (key === "where" || key.startsWith("params.")) continue
    shapeUrl.searchParams.set(key, value)
  }

  // Enforce user scoping — only this user's memos
  shapeUrl.searchParams.set("where", `"userId" = $1`)
  shapeUrl.searchParams.set("params.1", user.id)

  // Ensure table is set to memos
  shapeUrl.searchParams.set("table", "memos")

  // Authenticate with Electric Cloud (server-side only — never expose to client)
  shapeUrl.searchParams.set("source_id", c.env.ELECTRIC_ID)
  shapeUrl.searchParams.set("source_secret", c.env.ELECTRIC_SECRET)

  // Log without secrets
  const logUrl = new URL(shapeUrl.toString())
  logUrl.searchParams.delete("source_secret")
  console.log(`[electric-proxy] → ${logUrl.toString()}`)

  // Forward request to Electric
  const electricResponse = await fetch(shapeUrl.toString(), {
    headers: {
      Accept: c.req.header("accept") ?? "application/json",
      ...(c.req.header("if-none-match")
        ? { "If-None-Match": c.req.header("if-none-match")! }
        : {}),
    },
    signal: c.req.raw.signal,
  })

  // Forward Electric's response (including streaming headers)
  const headers = new Headers()
  for (const [key, value] of electricResponse.headers.entries()) {
    // Forward relevant headers from Electric
    if (
      key.startsWith("electric-") ||
      key === "etag" ||
      key === "cache-control" ||
      key === "content-type" ||
      key === "x-electric-chunk-last-offset" ||
      key === "x-electric-shape-id" ||
      key === "x-electric-schema"
    ) {
      headers.set(key, value)
    }
  }

  // Hono expects c.body() rather than raw Response for correct typing
  for (const [key, value] of headers.entries()) {
    c.header(key, value)
  }
  c.status(electricResponse.status as 200)
  return c.body(electricResponse.body as ReadableStream)
})
