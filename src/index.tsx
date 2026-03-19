import { Hono } from "hono"

const app = new Hono()

app.get("/", (c) => {
  return c.render("Hello, World!")
})

export default app
