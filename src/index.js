
import { analyzeCandles } from "./indicators.js";

const VERSION = "3.2.0";
const API_BASE = "https://api.mexc.com/api/v1/contract";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const intervals = {
  "1m": { api: "Min1", seconds: 60 },
  "5m": { api: "Min5", seconds: 300 },
  "15m": { api: "Min15", seconds: 900 },
  "30m": { api: "Min30", seconds: 1800 },
  "1h": { api: "Min60", seconds: 3600 },
  "4h": { api: "Hour4", seconds: 14400 },
  "8h": { api: "Hour8", seconds: 28800 },
  "1d": { api: "Day1", seconds: 86400 },
  "1w": { api: "Week1", seconds: 604800 },
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function errorResponse(error, status = 502, extra = {}) {
  return json(
    {
      success: false,
      error,
      message: String(extra.message || "Upstream request failed."),
      provider: "MEXC Futures",
      api_base: API_BASE,
      timestamp: new Date().toISOString(),
      ...extra,
    },
    status
  );
}

async function fetchJson(url) {
  let response;

  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      redirect: "follow",
    });
  } catch (error) {
    throw new Error(`Network error: ${String(error)}`);
  }

  if (!response.ok) {
    throw new Error(`Upstream HTTP ${response.status}`);
  }

  let body;

  try {
    body = await response.json();
  } catch {
    throw new Error("Upstream returned invalid JSON.");
  }

  if (!body || typeof body !== "object") {
    throw new Error("Unexpected upstream response format.");
  }

  return body;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeChange(value) {
  const number = numberOrNull(value);

  if (number === null) return null;

  return Math.abs(number) <= 1 ? number * 100 : number;
}

function logoUrl(symbol) {
  const normalized = String(symbol || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  if (!normalized) return null;

  return (
    "https://raw.githubusercontent.com/spothq/" +
    "cryptocurrency-icons/master/128/color/" +
    `${normalized}.png`
  );
}

function getBaseSymbol(contract) {
  return String(
    contract?.baseCoin ||
    contract?.symbol?.replace(/_USDT$/i, "") ||
    ""
  ).toUpperCase();
}

function validSymbol(symbol) {
  return /^[A-Z0-9]+_USDT$/.test(symbol);
}

function readArrayData(response) {
  return Array.isArray(response?.data) ? response.data : [];
}

// ======================================================
// MARKET EXPLORER
// GET /api/market?page=1&limit=100
// ======================================================

async function getMarket(url) {
  const page = Math.max(
    1,
    Number.parseInt(url.searchParams.get("page") || "1", 10) || 1
  );

  const requestedLimit = Number.parseInt(
    url.searchParams.get("limit") || "100",
    10
  );

  const limit = Math.min(500, Math.max(1, requestedLimit));

  const search = (url.searchParams.get("search") || "")
    .trim()
    .toUpperCase();

  const sort = (url.searchParams.get("sort") || "volume")
    .toLowerCase();

  const [detailResult, tickerResult] = await Promise.allSettled([
    fetchJson(`${API_BASE}/detail`),
    fetchJson(`${API_BASE}/ticker`),
  ]);

  if (tickerResult.status === "rejected") {
    return errorResponse(
      "Unable to fetch market data.",
      502,
      {
        message: String(tickerResult.reason),
        endpoint: "ticker",
      }
    );
  }

  const tickerResponse = tickerResult.value;
  const tickerData = readArrayData(tickerResponse);

  if (tickerResponse.success !== true || tickerData.length === 0) {
    return errorResponse(
      "MEXC returned no market ticker data.",
      502,
      {
        message: "Ticker response was empty or unsuccessful.",
        endpoint: "ticker",
      }
    );
  }

  const detailData =
    detailResult.status === "fulfilled" &&
    detailResult.value.success === true
      ? readArrayData(detailResult.value)
      : [];

  const detailsBySymbol = new Map(
    detailData.map((item) => [
      String(item.symbol || "").toUpperCase(),
      item,
    ])
  );

  let markets = tickerData
    .filter((ticker) => {
      const symbol = String(ticker.symbol || "").toUpperCase();

      return (
        validSymbol(symbol) &&
        numberOrNull(ticker.lastPrice) !== null
      );
    })
    .map((ticker) => {
      const contractSymbol = String(ticker.symbol).toUpperCase();

      const contract = detailsBySymbol.get(contractSymbol) || {
        symbol: contractSymbol,
      };

      const base = getBaseSymbol(contract);
      const price = numberOrNull(ticker.lastPrice);

      return {
        id: contractSymbol,
        name: contract.displayName || contract.baseCoin || base,
        symbol: base,
        contract_symbol: contractSymbol,
        quote_asset: contract.quoteCoin || "USDT",

        price_usd: price,
        price,

        change_24h_percent: normalizeChange(ticker.riseFallRate),
        volume_24h: numberOrNull(ticker.volume24),
        turnover_24h: numberOrNull(ticker.amount24),

        market_cap: null,

        high_24h: numberOrNull(ticker.high24Price),
        low_24h: numberOrNull(ticker.lower24Price),

        fair_price: numberOrNull(ticker.fairPrice),
        index_price: numberOrNull(ticker.indexPrice),
        funding_rate: numberOrNull(ticker.fundingRate),
        open_interest: numberOrNull(ticker.holdVol),

        logo_url: logoUrl(base),

        exchange: "MEXC Futures",
        market_type: "USDT Perpetual",

        price_scale: numberOrNull(contract.priceScale),
        volume_scale: numberOrNull(contract.volScale),
      };
    });

  if (search) {
    markets = markets.filter((coin) =>
      coin.symbol.includes(search) ||
      String(coin.name).toUpperCase().includes(search) ||
      coin.contract_symbol.includes(search)
    );
  }

  if (sort === "gainers") {
    markets.sort(
      (a, b) =>
        (b.change_24h_percent ?? -Infinity) -
        (a.change_24h_percent ?? -Infinity)
    );
  } else if (sort === "losers") {
    markets.sort(
      (a, b) =>
        (a.change_24h_percent ?? Infinity) -
        (b.change_24h_percent ?? Infinity)
    );
  } else if (sort === "price") {
    markets.sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
  } else {
    markets.sort(
      (a, b) => (b.turnover_24h ?? 0) - (a.turnover_24h ?? 0)
    );
  }

  const total = markets.length;
  const startIndex = (page - 1) * limit;
  const data = markets.slice(startIndex, startIndex + limit);

  return {
    success: true,
    name: "BlobSignal",
    version: VERSION,
    provider: "MEXC Futures",
    api_base: API_BASE,
    timestamp: new Date().toISOString(),
    currency: "USDT",
    market_type: "USDT Perpetual",

    count: data.length,
    total,
    page,
    limit,
    total_pages: Math.ceil(total / limit),
    has_next_page: startIndex + limit < total,

    search: search || null,
    sort,
    metadata_available: detailResult.status === "fulfilled",

    data,

    dataLimitations: [
      "Daftar berisi kontrak USDT perpetual yang dikembalikan MEXC.",
      "Market cap tidak tersedia dari endpoint ticker futures.",
      "Funding dan open interest mengikuti definisi serta ketersediaan data MEXC.",
      "Open interest ditampilkan sebagai holdVol mentah.",
      "Logo publik tidak dijamin tersedia untuk setiap token.",
      "Harga dan statistik market dapat berubah setiap saat.",
    ],
  };
}

// ======================================================
// SINGLE CONTRACT TICKER
// GET /api/ticker?symbol=BTC_USDT
// ======================================================

async function getTickerDetail(url) {
  const symbol = (
    url.searchParams.get("symbol") || "BTC_USDT"
  ).toUpperCase();

  if (!validSymbol(symbol)) {
    return json({
      success: false,
      error: "Invalid symbol. Use a format such as BTC_USDT.",
    }, 400);
  }

  try {
    const result = await fetchJson(
      `${API_BASE}/ticker?symbol=${encodeURIComponent(symbol)}`
    );

    const ticker = result.data;

    if (
      result.success !== true ||
      !ticker ||
      Array.isArray(ticker) ||
      String(ticker.symbol || "").toUpperCase() !== symbol
    ) {
      return errorResponse(
        "Invalid MEXC ticker response.",
        502,
        { symbol }
      );
    }

    const fundingRate = numberOrNull(ticker.fundingRate);
    const timestamp = numberOrNull(ticker.timestamp);

    return json({
      success: true,
      name: "BlobSignal",
      version: VERSION,
      provider: "MEXC Futures",
      symbol,

      timestamp: timestamp !== null
        ? new Date(timestamp).toISOString()
        : new Date().toISOString(),

      price: numberOrNull(ticker.lastPrice),
      bid: numberOrNull(ticker.bid1),
      ask: numberOrNull(ticker.ask1),

      fair_price: numberOrNull(ticker.fairPrice),
      index_price: numberOrNull(ticker.indexPrice),

      funding_rate: fundingRate,
      funding_rate_percent: fundingRate === null
        ? null
        : fundingRate * 100,

      open_interest: numberOrNull(ticker.holdVol),

      volume_24h: numberOrNull(ticker.volume24),
      turnover_24h: numberOrNull(ticker.amount24),
      high_24h: numberOrNull(ticker.high24Price),
      low_24h: numberOrNull(ticker.lower24Price),

      change_24h_percent: normalizeChange(ticker.riseFallRate),

      dataLimitations: [
        "Open interest memakai nilai holdVol mentah.",
        "Funding rate berasal dari snapshot ticker.",
        "Ticker tidak menyediakan riwayat OI atau funding.",
        "Data dapat berubah setelah respons dikirim.",
      ],
    });
  } catch (error) {
    return errorResponse(
      "Unable to fetch ticker detail.",
      502,
      {
        message: String(error),
        symbol,
        endpoint: "ticker",
      }
    );
  }
}

// ======================================================
// TECHNICAL ANALYSIS
// GET /api/technicals?symbol=BTC_USDT&interval=1h
// ======================================================

async function getTechnicals(url) {
  const symbol = (
    url.searchParams.get("symbol") || "BTC_USDT"
  ).toUpperCase();

  const interval = url.searchParams.get("interval") || "15m";

  if (!validSymbol(symbol)) {
    return json({
      success: false,
      error: "Invalid symbol. Use a format such as BTC_USDT.",
    }, 400);
  }

  if (!Object.hasOwn(intervals, interval)) {
    return json({
      success: false,
      error: "Unsupported interval.",
      available: Object.keys(intervals),
    }, 400);
  }

  const requestedCandles = Math.min(
    500,
    Math.max(
      50,
      Number.parseInt(url.searchParams.get("limit") || "250", 10) || 250
    )
  );

  const end = Math.floor(Date.now() / 1000);
  const candleDuration = intervals[interval].seconds;
  const start = end - candleDuration * requestedCandles;

  const endpoint =
    `${API_BASE}/kline/${encodeURIComponent(symbol)}` +
    `?interval=${intervals[interval].api}` +
    `&start=${start}&end=${end}`;

  try {
    const result = await fetchJson(endpoint);
    const raw = result.data;

    if (
      result.success !== true ||
      !raw ||
      !Array.isArray(raw.time) ||
      !Array.isArray(raw.open) ||
      !Array.isArray(raw.high) ||
      !Array.isArray(raw.low) ||
      !Array.isArray(raw.close) ||
      !Array.isArray(raw.vol)
    ) {
      return errorResponse(
        "Invalid MEXC candle response.",
        502,
        {
          symbol,
          interval,
          endpoint: "kline",
          message: String(result.message || "Unexpected candle format."),
        }
      );
    }

    const candles = raw.time
      .map((time, i) => ({
        time: Number(time),
        open: Number(raw.open[i]),
        high: Number(raw.high[i]),
        low: Number(raw.low[i]),
        close: Number(raw.close[i]),
        volume: Number(raw.vol[i]),
      }))
      .filter((c) =>
        Number.isFinite(c.time) &&
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close) &&
        Number.isFinite(c.volume) &&
        c.high >= c.low
      )
      .sort((a, b) => a.time - b.time);

    if (candles.length === 0) {
      return errorResponse(
        "MEXC returned no usable candles.",
        502,
        {
          symbol,
          interval,
          message: "No valid OHLCV candles were returned.",
        }
      );
    }

    const completedCandles = candles.filter(
      (c) => c.time + candleDuration <= end
    );

    if (completedCandles.length === 0) {
      return errorResponse(
        "No completed candles available for analysis.",
        502,
        { symbol, interval }
      );
    }

    let analysis;

    try {
      analysis = analyzeCandles(completedCandles);
    } catch (error) {
      return errorResponse(
        "Technical indicator calculation failed.",
        500,
        {
          message: String(error),
          symbol,
          interval,
        }
      );
    }

    return json({
      success: true,
      name: "BlobSignal",
      version: VERSION,
      provider: "MEXC Futures",
      api_base: API_BASE,
      symbol,
      interval,
      timestamp: new Date().toISOString(),

      candleCount: completedCandles.length,
      latestCandle: completedCandles[completedCandles.length - 1],
      candles: completedCandles,

      chartCandles: candles,
      chartCandleCount: candles.length,
      lastChartCandle: candles[candles.length - 1],
      candleDurationSeconds: candleDuration,

      analysis,

      dataLimitations: [
        "Candle berasal dari endpoint kontrak futures MEXC.",
        "Candle aktif hanya disertakan pada chartCandles.",
        "Frontend perlu melakukan polling atau memakai WebSocket.",
        "Funding rate dan open interest tidak dihitung dari candle.",
        "Indikator bukan jaminan profit.",
      ],
    });
  } catch (error) {
    return errorResponse(
      "Technical analysis request failed.",
      502,
      {
        message: String(error),
        symbol,
        interval,
        endpoint: "kline",
      }
    );
  }
}

// ======================================================
// CLOUDFLARE WORKER ROUTER
// ======================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    if (request.method !== "GET") {
      return json({
        success: false,
        error: "Method not allowed.",
      }, 405, {
        Allow: "GET, OPTIONS",
      });
    }

    if (url.pathname === "/health") {
      return json({
        success: true,
        status: "healthy",
        service: "blobsignal",
        version: VERSION,
        provider: "MEXC Futures",
        api_base: API_BASE,
        timestamp: new Date().toISOString(),
        endpoints: [
          "/health",
          "/api/market",
          "/api/market?page=1&limit=100",
          "/api/market?search=BTC",
          "/api/market?sort=gainers",
          "/api/market?sort=losers",
          "/api/market?sort=volume",
          "/api/ticker?symbol=BTC_USDT",
          "/api/technicals?symbol=BTC_USDT&interval=15m",
          "/api/technicals?symbol=BTC_USDT&interval=1h&limit=250",
        ],
      });
    }

    if (url.pathname === "/api/market") {
      try {
        const result = await getMarket(url);

        if (result instanceof Response) return result;

        return json(result);
      } catch (error) {
        return errorResponse(
          "Unable to fetch market data.",
          502,
          { message: String(error) }
        );
      }
    }

    if (url.pathname === "/api/ticker") {
      return getTickerDetail(url);
    }

    if (url.pathname === "/api/technicals") {
      return getTechnicals(url);
    }

    // Aset statis seperti index.html dan mascot.png.
    if (env?.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return json({
      success: false,
      error: "Not found.",
      path: url.pathname,
    }, 404);
  },
};
