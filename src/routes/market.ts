import { Hono } from "hono"
import { mstockFetch } from "../services/mstock-client"

type Env = {
  Bindings: {
    MSTOCK_API_KEY: string
    MSTOCK_API_SECRET: string
    MSTOCK_TOTP_SECRET?: string
  }
  Variables: {
    user: { id: string; name: string; email: string }
    session: unknown
  }
}

type MstockEnv = {
  MSTOCK_API_KEY: string
  MSTOCK_API_SECRET: string
  MSTOCK_TOTP_SECRET?: string
}

function getMstockEnv(bindings: Env["Bindings"]): MstockEnv {
  return {
    MSTOCK_API_KEY: bindings.MSTOCK_API_KEY,
    MSTOCK_API_SECRET: bindings.MSTOCK_API_SECRET,
    MSTOCK_TOTP_SECRET: bindings.MSTOCK_TOTP_SECRET,
  }
}

export const marketRoutes = new Hono<Env>()

// Error handler
marketRoutes.onError((err, c) => {
  console.error("[market-api] Error:", err.message, err.stack)
  return c.json({ error: err.message }, 500)
})

// ---------- Index tokens for LTP queries ----------
// Format: EXCHANGE:SYMBOL
const INDEX_TOKENS = [
  "NSE:Nifty 50",
  "NSE:Nifty Bank",
  "BSE:SENSEX",
  "NSE:Nifty IT",
  "NSE:Nifty Financial Services",
  "NSE:Nifty Pharma",
] as const

const SECTOR_TOKENS = [
  { name: "IT", symbol: "NSE:Nifty IT" },
  { name: "Bank", symbol: "NSE:Nifty Bank" },
  { name: "Pharma", symbol: "NSE:Nifty Pharma" },
  { name: "Auto", symbol: "NSE:Nifty Auto" },
  { name: "Metal", symbol: "NSE:Nifty Metal" },
  { name: "Realty", symbol: "NSE:Nifty Realty" },
  { name: "Energy", symbol: "NSE:Nifty Energy" },
  { name: "FMCG", symbol: "NSE:NIFTY FMCG" },
  { name: "PSU Bank", symbol: "NSE:Nifty PSU Bank" },
  { name: "Media", symbol: "NSE:Nifty Media" },
  { name: "Infra", symbol: "NSE:NIFTY INFRA" },
  { name: "Financial", symbol: "NSE:Nifty Financial Services" },
  { name: "Private Bank", symbol: "NSE:Nifty Private Bank" },
] as const

// ---------- Types for mStock API responses ----------
type MstockLtpItem = {
  instrument_token: string
  last_price: number
  ohlc?: {
    open: number
    high: number
    low: number
    close: number
  }
}

type MstockLtpResponse = {
  status: string
  data: Record<string, MstockLtpItem>
}

type MstockOhlcResponse = {
  status: string
  data: Record<
    string,
    {
      instrument_token: string
      last_price: number
      ohlc: { open: number; high: number; low: number; close: number }
    }
  >
}

type MstockGainerLoserItem = {
  symbol: string
  companyName?: string
  lastTradedPrice: number
  change: number
  percentChange: number
  volume?: number
  instrumentToken?: string
  exchange?: string
}

type MstockGainerLoserResponse = {
  status: string
  data: MstockGainerLoserItem[]
}

type MstockIntradayResponse = {
  status: string
  data: {
    candles: [string, number, number, number, number, number][] // [timestamp, O, H, L, C, V]
  }
}

// ---------- Script Master cache ----------
type InstrumentMaster = {
  instrumentToken: string
  exchangeToken: string
  tradingSymbol: string
  name: string
  exchange: string
  instrumentType: string
  lotSize: number
}

let scriptMasterCache: InstrumentMaster[] | null = null
let scriptMasterFetchedAt = 0
const SCRIPT_MASTER_TTL = 24 * 60 * 60 * 1000 // 24 hours

async function getScriptMaster(env: MstockEnv): Promise<InstrumentMaster[]> {
  if (
    scriptMasterCache &&
    Date.now() - scriptMasterFetchedAt < SCRIPT_MASTER_TTL
  ) {
    return scriptMasterCache
  }

  console.log("[market-api] Fetching script master CSV...")
  const csvText = await mstockFetch<string>(
    "/openapi/typea/instruments/scriptmaster",
    env
  )

  // Parse CSV: instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange
  const lines = (typeof csvText === "string" ? csvText : "").split("\n")
  const instruments: InstrumentMaster[] = []

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",")
    if (cols.length < 12) continue
    instruments.push({
      instrumentToken: cols[0],
      exchangeToken: cols[1],
      tradingSymbol: cols[2],
      name: cols[3],
      exchange: cols[11],
      instrumentType: cols[9],
      lotSize: parseInt(cols[8]) || 1,
    })
  }

  scriptMasterCache = instruments
  scriptMasterFetchedAt = Date.now()
  console.log(
    `[market-api] Script master cached: ${instruments.length} instruments`
  )
  return instruments
}

// ==========================================
// 1. GET /indices — Major index quotes
// ==========================================
marketRoutes.get("/indices", async (c) => {
  const env = getMstockEnv(c.env)
  const query = INDEX_TOKENS.map((t) => `i=${encodeURIComponent(t)}`).join("&")

  const data = await mstockFetch<MstockLtpResponse>(
    `/openapi/typea/instruments/quote/ohlc?${query}`,
    env
  )

  const indices = Object.entries(data.data ?? {}).map(([key, item]) => {
    const previousClose = item.ohlc?.close ?? 0
    const change = item.last_price - previousClose
    const changePercent = previousClose
      ? (change / previousClose) * 100
      : 0

    return {
      symbol: key,
      name: key.split(":")[1] ?? key,
      ltp: item.last_price,
      change: parseFloat(change.toFixed(2)),
      changePercent: parseFloat(changePercent.toFixed(2)),
      open: item.ohlc?.open ?? 0,
      high: item.ohlc?.high ?? 0,
      low: item.ohlc?.low ?? 0,
      previousClose,
    }
  })

  return c.json({ indices })
})

// ==========================================
// 2. POST /gainers-losers — Top movers
// ==========================================
marketRoutes.post("/gainers-losers", async (c) => {
  const env = getMstockEnv(c.env)
  const body = (await c.req.json()) as {
    exchange?: number
    typeFlag?: string
    count?: number
  }

  // exchange: 1=NSE, 4=BSE; typeFlag: "G"=gainers, "L"=losers
  const payload = {
    Exchange: body.exchange ?? 1,
    SecurityIdCode: 0,
    segment: 1,
    TypeFlag: body.typeFlag ?? "G",
  }

  const data = await mstockFetch<MstockGainerLoserResponse>(
    "/openapi/typea/losergainer",
    env,
    { method: "POST", body: JSON.stringify(payload) }
  )

  const stocks = (data.data ?? [])
    .slice(0, body.count ?? 20)
    .map((item) => ({
      symbol: item.symbol,
      name: item.companyName ?? item.symbol,
      ltp: item.lastTradedPrice,
      change: item.change,
      changePercent: item.percentChange,
      volume: item.volume ?? 0,
      instrumentToken: item.instrumentToken ?? "",
      exchange: item.exchange ?? "NSE",
    }))

  return c.json({ stocks })
})

// ==========================================
// 3. GET /sectors — Sector performance
// ==========================================
marketRoutes.get("/sectors", async (c) => {
  const env = getMstockEnv(c.env)
  const query = SECTOR_TOKENS.map((t) =>
    `i=${encodeURIComponent(t.symbol)}`
  ).join("&")

  const data = await mstockFetch<MstockOhlcResponse>(
    `/openapi/typea/instruments/quote/ohlc?${query}`,
    env
  )

  const sectors = SECTOR_TOKENS.map((sector) => {
    const item = data.data?.[sector.symbol]
    if (!item) {
      return {
        name: sector.name,
        symbol: sector.symbol,
        value: 0,
        change: 0,
        changePercent: 0,
      }
    }
    const previousClose = item.ohlc?.close ?? 0
    const change = item.last_price - previousClose
    const changePercent = previousClose
      ? (change / previousClose) * 100
      : 0

    return {
      name: sector.name,
      symbol: sector.symbol,
      value: item.last_price,
      change: parseFloat(change.toFixed(2)),
      changePercent: parseFloat(changePercent.toFixed(2)),
    }
  })

  return c.json({ sectors })
})

// ==========================================
// 4. GET /intraday/:exchange/:token/:interval
// ==========================================
marketRoutes.get("/intraday/:exchange/:token/:interval", async (c) => {
  const env = getMstockEnv(c.env)
  const { exchange, token, interval } = c.req.param()

  // exchange codes: 1=NSE, 2=NFO, 3=CDS, 4=BSE, 5=BFO
  // interval: minute, 3minute, 5minute, 10minute, 15minute, 30minute, 60minute, day
  const data = await mstockFetch<MstockIntradayResponse>(
    `/openapi/typea/instruments/intraday/${exchange}/${token}/${interval}`,
    env
  )

  const candles = (data.data?.candles ?? []).map((candle) => ({
    timestamp: new Date(candle[0]).getTime(),
    open: candle[1],
    high: candle[2],
    low: candle[3],
    close: candle[4],
    volume: candle[5],
  }))

  return c.json({ candles })
})

// ==========================================
// 5. GET /quote/:exchange/:symbol — Full OHLC quote
// ==========================================
marketRoutes.get("/quote/:exchange/:symbol", async (c) => {
  const env = getMstockEnv(c.env)
  const { exchange, symbol } = c.req.param()
  const key = `${exchange}:${symbol}`

  const data = await mstockFetch<MstockOhlcResponse>(
    `/openapi/typea/instruments/quote/ohlc?i=${encodeURIComponent(key)}`,
    env
  )

  const item = data.data?.[key]
  if (!item) {
    return c.json({ error: "Quote not found" }, 404)
  }

  const previousClose = item.ohlc?.close ?? 0
  const change = item.last_price - previousClose
  const changePercent = previousClose ? (change / previousClose) * 100 : 0

  return c.json({
    quote: {
      symbol: key,
      name: symbol,
      exchange,
      instrumentToken: item.instrument_token,
      ltp: item.last_price,
      change: parseFloat(change.toFixed(2)),
      changePercent: parseFloat(changePercent.toFixed(2)),
      open: item.ohlc?.open ?? 0,
      high: item.ohlc?.high ?? 0,
      low: item.ohlc?.low ?? 0,
      previousClose,
    },
  })
})

// ==========================================
// 6. GET /search?q=query — Instrument search
// ==========================================
marketRoutes.get("/search", async (c) => {
  const env = getMstockEnv(c.env)
  const query = (c.req.query("q") ?? "").toUpperCase().trim()

  if (!query || query.length < 2) {
    return c.json({ results: [] })
  }

  const instruments = await getScriptMaster(env)
  const results = instruments
    .filter(
      (inst) =>
        inst.tradingSymbol.toUpperCase().includes(query) ||
        inst.name.toUpperCase().includes(query)
    )
    .slice(0, 30)
    .map((inst) => ({
      symbol: inst.tradingSymbol,
      name: inst.name,
      exchange: inst.exchange,
      instrumentToken: inst.instrumentToken,
      instrumentType: inst.instrumentType,
      lotSize: inst.lotSize,
    }))

  return c.json({ results })
})

// ==========================================
// 7. GET /breadth — Market breadth (advances vs declines)
// ==========================================
marketRoutes.get("/breadth", async (c) => {
  const env = getMstockEnv(c.env)

  // Fetch gainers and losers counts in parallel
  const [gainersRes, losersRes] = await Promise.all([
    mstockFetch<MstockGainerLoserResponse>(
      "/openapi/typea/losergainer",
      env,
      {
        method: "POST",
        body: JSON.stringify({
          Exchange: 1,
          SecurityIdCode: 0,
          segment: 1,
          TypeFlag: "G",
        }),
      }
    ),
    mstockFetch<MstockGainerLoserResponse>(
      "/openapi/typea/losergainer",
      env,
      {
        method: "POST",
        body: JSON.stringify({
          Exchange: 1,
          SecurityIdCode: 0,
          segment: 1,
          TypeFlag: "L",
        }),
      }
    ),
  ])

  const advances = gainersRes.data?.length ?? 0
  const declines = losersRes.data?.length ?? 0
  const total = advances + declines
  const unchanged = Math.max(0, total - advances - declines)

  return c.json({
    breadth: {
      advances,
      declines,
      unchanged,
      total,
    },
  })
})
