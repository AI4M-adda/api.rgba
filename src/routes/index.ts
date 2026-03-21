import { Hono } from "hono"
import { userRoutes } from "./user"
import { memoRoutes } from "./studio/memo"

export function createRpcRoutes() {
  const rpc = new Hono()
  rpc.get("/ping", (c) => c.json({ pong: true }))
  rpc.route("/user", userRoutes)
  rpc.route("/memo", memoRoutes)
  return rpc
}
