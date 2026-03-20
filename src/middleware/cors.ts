import { cors } from "hono/cors"

export function createCorsMiddleware(trustedOrigins: string[]) {
  return cors({
    origin: trustedOrigins,
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  })
}
