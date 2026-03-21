import { Hono } from "hono"
import { createDb } from "@rgba/db"
import { marketPreferences } from "@rgba/db/schema"
import { updateMarketPreferencesSchema } from "@rgba/db/validation"
import { eq } from "drizzle-orm"

type Env = {
  Bindings: {
    DATABASE_URL: string
  }
  Variables: {
    user: { id: string; name: string; email: string }
    session: unknown
  }
}

export const marketPreferencesRoutes = new Hono<Env>()

marketPreferencesRoutes.onError((err, c) => {
  console.error("[market-preferences-api] Error:", err.message, err.stack)
  return c.json({ error: err.message }, 500)
})

// Get user's market preferences (create defaults if not exists)
marketPreferencesRoutes.get("/", async (c) => {
  const user = c.get("user")
  const db = createDb(c.env.DATABASE_URL)

  const [existing] = await db
    .select()
    .from(marketPreferences)
    .where(eq(marketPreferences.userId, user.id))

  if (existing) {
    return c.json({ preferences: existing })
  }

  // Create default preferences
  const [created] = await db
    .insert(marketPreferences)
    .values({ userId: user.id })
    .returning()

  return c.json({ preferences: created })
})

// Update user's market preferences
marketPreferencesRoutes.patch("/", async (c) => {
  const user = c.get("user")
  const db = createDb(c.env.DATABASE_URL)
  const body = await c.req.json()

  const parsed = updateMarketPreferencesSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten().fieldErrors }, 400)
  }

  // Upsert: update if exists, insert if not
  const [existing] = await db
    .select()
    .from(marketPreferences)
    .where(eq(marketPreferences.userId, user.id))

  if (existing) {
    const [updated] = await db
      .update(marketPreferences)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(marketPreferences.userId, user.id))
      .returning()

    return c.json({ preferences: updated })
  }

  const [created] = await db
    .insert(marketPreferences)
    .values({ userId: user.id, ...parsed.data })
    .returning()

  return c.json({ preferences: created })
})
