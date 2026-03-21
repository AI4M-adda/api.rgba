import { Hono } from "hono"
import { createDb } from "@rgba/db"
import { watchlistItems } from "@rgba/db/schema"
import { addWatchlistItemSchema } from "@rgba/db/validation"
import { eq, and, asc } from "drizzle-orm"

type Env = {
  Bindings: {
    DATABASE_URL: string
  }
  Variables: {
    user: { id: string; name: string; email: string }
    session: unknown
  }
}

export const watchlistRoutes = new Hono<Env>()

watchlistRoutes.onError((err, c) => {
  console.error("[watchlist-api] Error:", err.message, err.stack)
  return c.json({ error: err.message }, 500)
})

// List user's watchlist items (sorted by sortOrder)
watchlistRoutes.get("/", async (c) => {
  const user = c.get("user")
  const db = createDb(c.env.DATABASE_URL)

  const items = await db
    .select()
    .from(watchlistItems)
    .where(eq(watchlistItems.userId, user.id))
    .orderBy(asc(watchlistItems.sortOrder))

  return c.json({ items })
})

// Add a watchlist item
watchlistRoutes.post("/", async (c) => {
  const user = c.get("user")
  const db = createDb(c.env.DATABASE_URL)
  const body = await c.req.json()

  const parsed = addWatchlistItemSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten().fieldErrors }, 400)
  }

  const [item] = await db
    .insert(watchlistItems)
    .values({
      userId: user.id,
      symbol: parsed.data.symbol,
      exchange: parsed.data.exchange,
      instrumentToken: parsed.data.instrumentToken,
      instrumentType: parsed.data.instrumentType,
      displayName: parsed.data.displayName,
    })
    .returning()

  return c.json({ item }, 201)
})

// Remove a watchlist item
watchlistRoutes.delete("/:id", async (c) => {
  const user = c.get("user")
  const db = createDb(c.env.DATABASE_URL)
  const id = c.req.param("id")

  const [item] = await db
    .delete(watchlistItems)
    .where(and(eq(watchlistItems.id, id), eq(watchlistItems.userId, user.id)))
    .returning()

  if (!item) {
    return c.json({ error: "Item not found" }, 404)
  }

  return c.json({ success: true })
})

// Reorder watchlist items
watchlistRoutes.patch("/reorder", async (c) => {
  const user = c.get("user")
  const db = createDb(c.env.DATABASE_URL)
  const body = (await c.req.json()) as { items: { id: string; sortOrder: number }[] }

  if (!Array.isArray(body.items)) {
    return c.json({ error: "items array is required" }, 400)
  }

  for (const { id, sortOrder } of body.items) {
    await db
      .update(watchlistItems)
      .set({ sortOrder })
      .where(
        and(eq(watchlistItems.id, id), eq(watchlistItems.userId, user.id))
      )
  }

  return c.json({ success: true })
})
