
import { analyzeCandles } from "./indicators.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const API_BASE = "https://contract.mexc.com/api/v1/contract";

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

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`);
  }

  return response.json();
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

  // Rasio 0.05 = 5%.
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
    contract.baseCoin ||
    contract.symbol?.replace(/_USDT$/i, "") ||
    ""
  ).toUpperCase();
}

// ======================================================
// MARKET EXPLORER
// GET /api/market
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
    throw new Error(
      `Gagal mengambil ticker MEXC: ${String(tickerResult.reason)}`
    );
  }

  const tickerResponse = tickerResult.value;

  const tickerData = Array.isArray(tickerResponse.data)
    ? tickerResponse.data
    : [];

  if (tickerResponse.success !== true || tickerData.length === 0) {
    throw new Error("MEXC tidak mengembalikan data ticker.");
  }

  const detailData =
    detailResult.status === "fulfilled" &&
    Array.isArray(detailResult.value.data)
      ? detailResult.value.data
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
        /^[A-Z0-9]+_USDT$/.test(symbol) &&
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

        // Kompatibilitas dengan frontend lama.
        price_usd: price,

        price,
        change_24h_percent: normalizeChange(ticker.riseFallRate),
        volume_24h: numberOrNull(ticker.volume24),
        turnover_24h: numberOrNull(ticker.amount24),

        // Tidak disediakan langsung oleh ticker futures ini.
        market_cap: null,

        high_24h: numberOrNull(ticker.high24Price),
        low_24h: numberOrNull(ticker.lower24Price),

        fair_price: numberOrNull(ticker.fairPrice),
        index_price: numberOrNull(ticker.indexPrice),
        funding_rate: numberOrNull(ticker.fundingRate),

        // Nilai mentah holdVol; satuan harus ditafsirkan
        // berdasarkan spesifikasi kontrak MEXC.
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
    provider: "MEXC Futures",
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
      "Market cap tidak tersedia pada endpoint ticker futures ini.",
      "Funding dan open interest mengikuti definisi serta ketersediaan data MEXC.",
      "Open interest ditampilkan sebagai nilai holdVol mentah; jangan menganggapnya USDT tanpa konversi yang terverifikasi.",
      "Logo menggunakan repositori ikon publik berdasarkan simbol dan tidak dijamin tersedia untuk setiap token.",
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

  if (!/^[A-Z0-9]+_USDT$/.test(symbol)) {
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
      return json({
        success: false,
        error: "Invalid MEXC ticker response.",
        symbol,
      }, 502);
    }

    const fundingRate = numberOrNull(ticker.fundingRate);
    const timestamp = numberOrNull(ticker.timestamp);

    return json({
      success: true,
      name: "BlobSignal",
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

      // Contoh 0.000031 menjadi 0.0031 (%).
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
        "Open interest menggunakan nilai holdVol dari MEXC; satuan dan konversinya perlu dikonfirmasi.",
        "Funding rate berasal dari snapshot ticker; interval funding tidak diasumsikan.",
        "Endpoint ini tidak menyediakan riwayat funding rate atau riwayat open interest.",
        "Ticker merupakan snapshot dan dapat berubah setelah respons dikirim.",
      ],
    });
  } catch (error) {
    return json({
      success: false,
      error: "Unable to fetch ticker detail.",
      message: String(error),
      symbol,
    }, 502);
  }
}

// ======================================================
// TECHNICAL ANALYSIS
// GET /api/technicals?symbol=BTC_USDT&interval=15m
// ======================================================

async function getTechnicals(url) {
  const symbol = (
    url.searchParams.get("symbol") || "BTC_USDT"
  ).toUpperCase();

  const interval = url.searchParams.get("interval") || "15m";

  if (!/^[A-Z0-9]+_USDT$/.test(symbol)) {
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

  try {
    const end = Math.floor(Date.now() / 1000);
    const candleDuration = intervals[interval].seconds;

    const requestedCandles = Math.min(
      500,
      Math.max(
        50,
        Number.parseInt(
          url.searchParams.get("limit") || "250",
          10
        ) || 250
      )
    );

    const start = end - candleDuration * requestedCandles;

    const endpoint =
      `${API_BASE}/kline/${encodeURIComponent(symbol)}` +
      `?interval=${intervals[interval].api}` +
      `&start=${start}&end=${end}`;

    const result = await fetchJson(endpoint);

    if (
      result.success !== true ||
      !result.data ||
      !Array.isArray(result.data.time) ||
      !Array.isArray(result.data.open) ||
      !Array.isArray(result.data.high) ||
      !Array.isArray(result.data.low) ||
      !Array.isArray(result.data.close) ||
      !Array.isArray(result.data.vol)
    ) {
      return json({
        success: false,
        error: "Invalid MEXC candle response.",
        provider_message: result.message ?? null,
        symbol,
        interval,
      }, 502);
    }

    const raw = result.data;

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
      return json({
        success: false,
        error: "MEXC returned no usable candles.",
        symbol,
        interval,
      }, 502);
    }

    // Chart menyertakan candle yang sedang berjalan.
    // Indikator hanya memakai candle yang sudah selesai.
    const completedCandles = candles.filter(
      (c) => c.time + candleDuration <= end
    );

    if (completedCandles.length === 0) {
      return json({
        success: false,
        error: "No completed candles available for analysis.",
        symbol,
        interval,
      }, 502);
    }

    const analysis = analyzeCandles(completedCandles);

    const latestCandle =
      completedCandles[completedCandles.length - 1];

    return json({
      success: true,
      name: "BlobSignal",
      provider: "MEXC Futures",
      symbol,
      interval,
      timestamp: new Date().toISOString(),

      candleCount: completedCandles.length,
      latestCandle,
      candles: completedCandles,

      chartCandles: candles,
      chartCandleCount: candles.length,
      lastChartCandle: candles[candles.length - 1],
      candleDurationSeconds: candleDuration,

      analysis,

      dataLimitations: [
        "Candle berasal dari endpoint kontrak futures MEXC.",
        "Candle yang belum selesai hanya disertakan pada chartCandles.",
        "Frontend perlu melakukan polling atau memakai WebSocket agar chart diperbarui.",
        "Funding rate dan open interest tidak dihitung dari data candle.",
        "Indikator teknikal bukan jaminan profit atau probabilitas keberhasilan trading.",
      ],
    });
  } catch (error) {
    return json({
      success: false,
      error: "Technical analysis request failed.",
      message: String(error),
      symbol,
      interval,
    }, 502);
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
      }, 405);
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return env.ASSETS.fetch(
        new Request(new URL("/index.html", request.url), request)
      );
    }

    if (url.pathname === "/health") {
      return json({
        success: true,
        status: "healthy",
        service: "blobsignal",
        version: "3.1.0",
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
        return json(await getMarket(url));
      } catch (error) {
        return json({
          success: false,
          error: "Unable to fetch market data.",
          message: String(error),
          provider: "MEXC Futures",
        }, 502);
      }
    }

    if (url.pathname === "/api/ticker") {
      return getTickerDetail(url);
    }

    if (url.pathname === "/api/technicals") {
      return getTechnicals(url);
    }

    return env.ASSETS.fetch(request);
  },
};
