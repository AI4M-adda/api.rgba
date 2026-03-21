const MSTOCK_BASE_URL = "https://api.mstock.trade"

type MstockSession = {
  accessToken: string
  expiresAt: number // Unix timestamp (midnight IST)
}

let cachedSession: MstockSession | null = null

/**
 * Get midnight IST as a Unix timestamp for token expiry.
 * mStock tokens expire at midnight IST each day.
 */
function getNextMidnightIST(): number {
  const now = new Date()
  // IST is UTC+5:30
  const istOffset = 5.5 * 60 * 60 * 1000
  const istNow = new Date(now.getTime() + istOffset)
  const istMidnight = new Date(istNow)
  istMidnight.setUTCHours(0, 0, 0, 0)
  istMidnight.setUTCDate(istMidnight.getUTCDate() + 1)
  // Convert back to UTC timestamp
  return istMidnight.getTime() - istOffset
}

/**
 * Login to mStock and get a request token (GUID).
 */
async function login(apiKey: string, apiSecret: string): Promise<string> {
  const res = await fetch(`${MSTOCK_BASE_URL}/openapi/typea/connect/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, password: apiSecret }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`mStock login failed: ${res.status} — ${text}`)
  }

  const data = (await res.json()) as { data?: { request_token?: string } }
  const requestToken = data?.data?.request_token
  if (!requestToken) {
    throw new Error("mStock login: no request_token in response")
  }
  return requestToken
}

/**
 * Generate session token using TOTP verification.
 */
async function verifyTotp(
  apiKey: string,
  totp: string
): Promise<string> {
  const res = await fetch(
    `${MSTOCK_BASE_URL}/openapi/typea/session/verifytotp`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Mirae-Version": "1",
      },
      body: JSON.stringify({ api_key: apiKey, totp }),
    }
  )

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`mStock TOTP verification failed: ${res.status} — ${text}`)
  }

  const data = (await res.json()) as { data?: { access_token?: string } }
  const accessToken = data?.data?.access_token
  if (!accessToken) {
    throw new Error("mStock TOTP: no access_token in response")
  }
  return accessToken
}

/**
 * Generate a TOTP code from a base32 secret.
 * Implements RFC 6238 (TOTP) with SHA-1, 6 digits, 30s step.
 */
async function generateTotp(secret: string): Promise<string> {
  // Decode base32 secret
  const base32Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  const cleanSecret = secret.replace(/[\s=]/g, "").toUpperCase()
  let bits = ""
  for (const char of cleanSecret) {
    const val = base32Chars.indexOf(char)
    if (val === -1) throw new Error(`Invalid base32 character: ${char}`)
    bits += val.toString(2).padStart(5, "0")
  }
  const keyBytes = new Uint8Array(Math.floor(bits.length / 8))
  for (let i = 0; i < keyBytes.length; i++) {
    keyBytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2)
  }

  // Time counter (30-second step)
  const time = Math.floor(Date.now() / 1000 / 30)
  const timeBuffer = new ArrayBuffer(8)
  const timeView = new DataView(timeBuffer)
  timeView.setUint32(4, time, false)

  // HMAC-SHA1
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  )
  const hmac = await crypto.subtle.sign("HMAC", key, timeBuffer)
  const hmacBytes = new Uint8Array(hmac)

  // Dynamic truncation
  const offset = hmacBytes[hmacBytes.length - 1] & 0x0f
  const code =
    ((hmacBytes[offset] & 0x7f) << 24) |
    ((hmacBytes[offset + 1] & 0xff) << 16) |
    ((hmacBytes[offset + 2] & 0xff) << 8) |
    (hmacBytes[offset + 3] & 0xff)

  return (code % 1000000).toString().padStart(6, "0")
}

/**
 * Get a valid mStock access token.
 * Uses in-memory cache, refreshes daily at midnight IST.
 */
export async function getMstockToken(env: {
  MSTOCK_API_KEY: string
  MSTOCK_API_SECRET: string
  MSTOCK_TOTP_SECRET?: string
}): Promise<string> {
  // Return cached token if still valid
  if (cachedSession && Date.now() < cachedSession.expiresAt) {
    return cachedSession.accessToken
  }

  console.log("[mstock-auth] Generating new session token...")

  // Step 1: Login to get request_token
  await login(env.MSTOCK_API_KEY, env.MSTOCK_API_SECRET)

  // Step 2: Verify TOTP to get access_token
  if (!env.MSTOCK_TOTP_SECRET) {
    throw new Error("MSTOCK_TOTP_SECRET is required for automated auth")
  }
  const totp = await generateTotp(env.MSTOCK_TOTP_SECRET)
  const accessToken = await verifyTotp(env.MSTOCK_API_KEY, totp)

  // Cache until midnight IST
  cachedSession = {
    accessToken,
    expiresAt: getNextMidnightIST(),
  }

  console.log("[mstock-auth] Session token cached until midnight IST")
  return accessToken
}

/**
 * Build auth headers for mStock API requests.
 */
export function getMstockHeaders(
  apiKey: string,
  accessToken: string
): Record<string, string> {
  return {
    "X-Mirae-Version": "1",
    Authorization: `token ${apiKey}:${accessToken}`,
    "Content-Type": "application/json",
  }
}

/**
 * Invalidate the cached session (e.g., on auth errors).
 */
export function clearMstockSession(): void {
  cachedSession = null
}
