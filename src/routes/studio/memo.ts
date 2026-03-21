import { Hono } from "hono"
import { createDb } from "@rgba/db"
import { memos } from "@rgba/db/schema"
import { eq, and, desc, like, sql } from "drizzle-orm"

type Env = {
  Bindings: {
    DATABASE_URL: string
  }
  Variables: {
    user: { id: string; name: string; email: string }
    session: unknown
  }
}

export const memoRoutes = new Hono<Env>()

// Global error handler — log and return useful error details
memoRoutes.onError((err, c) => {
  console.error("[memo-api] Error:", err.message, err.stack)
  return c.json(
    { error: err.message, stack: err.stack },
    500
  )
})

// List user's memos (sorted by createdAt desc, optional type filter & search)
memoRoutes.get("/", async (c) => {
  const user = c.get("user")
  const db = createDb(c.env.DATABASE_URL)
  const type = c.req.query("type")
  const search = c.req.query("search")

  const conditions = [eq(memos.userId, user.id)]
  if (type && (type === "voice" || type === "text")) {
    conditions.push(eq(memos.type, type))
  }
  if (search) {
    conditions.push(like(memos.title, `%${search}%`))
  }

  const result = await db
    .select()
    .from(memos)
    .where(and(...conditions))
    .orderBy(desc(memos.createdAt))

  return c.json({ memos: result })
})

// Get single memo
memoRoutes.get("/:id", async (c) => {
  const user = c.get("user")
  const db = createDb(c.env.DATABASE_URL)
  const id = c.req.param("id")

  const [memo] = await db
    .select()
    .from(memos)
    .where(and(eq(memos.id, id), eq(memos.userId, user.id)))

  if (!memo) {
    return c.json({ error: "Memo not found" }, 404)
  }

  return c.json({ memo })
})

// Create memo (voice or text) — returns txid for Electric sync confirmation
memoRoutes.post("/", async (c) => {
  const user = c.get("user")
  const db = createDb(c.env.DATABASE_URL)
  const body = await c.req.json()

  const { id, title, type, content, duration, fileSize } = body as {
    id?: string
    title: string
    type: "voice" | "text"
    content?: string
    duration?: number
    fileSize?: number
  }

  if (!title || !type) {
    return c.json({ error: "Title and type are required" }, 400)
  }

  const batchResult = await db.batch([
    db
      .insert(memos)
      .values({
        ...(id ? { id } : {}),
        userId: user.id,
        title,
        type,
        content: type === "text" ? (content ?? "") : null,
        duration: type === "voice" ? duration : null,
        fileSize: type === "voice" ? fileSize : null,
        status: type === "text" ? "done" : "recorded",
      })
      .returning(),
    db.execute(sql`SELECT txid_current()::text AS txid`),
  ])

  const [memo] = batchResult[0]
  const txid = Number((batchResult[1] as unknown as { rows: { txid: string }[] }).rows[0]?.txid)

  return c.json({ memo, txid }, 201)
})

// Update memo — returns txid for Electric sync confirmation
memoRoutes.patch("/:id", async (c) => {
  const user = c.get("user")
  const db = createDb(c.env.DATABASE_URL)
  const id = c.req.param("id")
  const body = await c.req.json()

  const { title, content, transcript } = body as {
    title?: string
    content?: string
    transcript?: string
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (title !== undefined) updates.title = title
  if (content !== undefined) updates.content = content
  if (transcript !== undefined) updates.transcript = transcript

  const batchResult = await db.batch([
    db
      .update(memos)
      .set(updates)
      .where(and(eq(memos.id, id), eq(memos.userId, user.id)))
      .returning(),
    db.execute(sql`SELECT txid_current()::text AS txid`),
  ])

  const [memo] = batchResult[0]
  if (!memo) {
    return c.json({ error: "Memo not found" }, 404)
  }

  const txid = Number((batchResult[1] as unknown as { rows: { txid: string }[] }).rows[0]?.txid)

  return c.json({ memo, txid })
})

// Delete memo — returns txid for Electric sync confirmation
memoRoutes.delete("/:id", async (c) => {
  const user = c.get("user")
  const db = createDb(c.env.DATABASE_URL)
  const id = c.req.param("id")

  const batchResult = await db.batch([
    db
      .delete(memos)
      .where(and(eq(memos.id, id), eq(memos.userId, user.id)))
      .returning(),
    db.execute(sql`SELECT txid_current()::text AS txid`),
  ])

  const [memo] = batchResult[0]
  if (!memo) {
    return c.json({ error: "Memo not found" }, 404)
  }

  const txid = Number((batchResult[1] as unknown as { rows: { txid: string }[] }).rows[0]?.txid)

  return c.json({ success: true, txid })
})

// Upload audio file (placeholder — store as base64 or integrate R2 later)
memoRoutes.post("/:id/upload", async (c) => {
  const user = c.get("user")
  const db = createDb(c.env.DATABASE_URL)
  const id = c.req.param("id")

  // Verify memo belongs to user
  const [existing] = await db
    .select()
    .from(memos)
    .where(and(eq(memos.id, id), eq(memos.userId, user.id)))

  if (!existing) {
    return c.json({ error: "Memo not found" }, 404)
  }

  if (existing.type !== "voice") {
    return c.json({ error: "Upload is only for voice memos" }, 400)
  }

  // TODO: Integrate Cloudflare R2 or other storage
  // For now, acknowledge the upload
  const [memo] = await db
    .update(memos)
    .set({ status: "done", updatedAt: new Date() })
    .where(eq(memos.id, id))
    .returning()

  return c.json({ memo })
})
