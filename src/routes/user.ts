import { Hono } from "hono"

type Env = {
  Variables: {
    user: unknown
    session: unknown
  }
}

export const userRoutes = new Hono<Env>()

userRoutes.get("/me", (c) => {
  const user = c.get("user")
  return c.json({ user })
})
