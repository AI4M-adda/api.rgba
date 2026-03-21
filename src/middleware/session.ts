import type { MiddlewareHandler } from "hono"

type AuthInstance = {
  api: {
    getSession: (opts: {
      headers: Headers
    }) => Promise<{ user: unknown; session: unknown } | null>
  }
}

export function sessionMiddleware(auth: AuthInstance): MiddlewareHandler {
  return async (c, next) => {
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: c.req.header("cookie") ?? "" }),
    })

    if (!session) {
      return c.json({ error: "Unauthorized" }, 401)
    }

    c.set("user", session.user)
    c.set("session", session.session)
    await next()
  }
}
