import { Hono } from "hono"
import { userRoutes } from "./user"

export function createRpcRoutes() {
  const rpc = new Hono()
  rpc.route("/user", userRoutes)
  return rpc
}
