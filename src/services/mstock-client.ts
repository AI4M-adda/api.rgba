import {
  getMstockToken,
  getMstockHeaders,
  clearMstockSession,
} from "./mstock-auth"

const MSTOCK_BASE_URL = "https://api.mstock.trade"

type MstockEnv = {
  MSTOCK_API_KEY: string
  MSTOCK_API_SECRET: string
  MSTOCK_TOTP_SECRET?: string
}

/**
 * Fetch wrapper for mStock API calls.
 * Handles auth headers, token refresh on 401, and error parsing.
 */
export async function mstockFetch<T>(
  path: string,
  env: MstockEnv,
  options?: RequestInit
): Promise<T> {
  const token = await getMstockToken(env)
  const headers = getMstockHeaders(env.MSTOCK_API_KEY, token)

  const res = await fetch(`${MSTOCK_BASE_URL}${path}`, {
    ...options,
    headers: { ...headers, ...options?.headers },
  })

  // If 401, clear cache and retry once
  if (res.status === 401) {
    console.warn("[mstock-client] 401 — clearing session and retrying...")
    clearMstockSession()
    const newToken = await getMstockToken(env)
    const newHeaders = getMstockHeaders(env.MSTOCK_API_KEY, newToken)

    const retryRes = await fetch(`${MSTOCK_BASE_URL}${path}`, {
      ...options,
      headers: { ...newHeaders, ...options?.headers },
    })

    if (!retryRes.ok) {
      const text = await retryRes.text()
      throw new Error(
        `mStock API error (retry): ${retryRes.status} — ${text}`
      )
    }
    return retryRes.json() as Promise<T>
  }

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`mStock API error: ${res.status} — ${text}`)
  }

  return res.json() as Promise<T>
}
