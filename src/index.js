
import { analyzeCandles } from "./indicators.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
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

const intervals = {
  "1m": "Min1",
  "5m": "Min5",
  "15m": "Min15",
  "30m": "Min30",
  "1h": "Min60",
  "4h": "Hour4",
  "8h": "Hour8",
  "1d": "Day1",
  "1w": "Week1",
};

async function getMarket() {
  const apiUrl =
    "https://pro-api.coinmarketcap.com/public-api/v2/simple/price" +
    "?symbol=BTC,ETH,SOL&convert=USD";

  const response = await fetch(apiUrl, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`CoinMarketCap HTTP ${response.status}`);
  }

  const result = await response.json();

  if (
    Number(result.status?.error_code) !== 0 ||
    !Array.isArray(result.data)
  ) {
    throw new Error(
      result.status?.error_message || "Invalid CoinMarketCap response"
    );
  }

  return {
    success: true,
    name: "Crypto Research AI",
    provider: "CoinMarketCap",
    timestamp: result.status?.timestamp ?? new Date().toISOString(),
    currency: "USD",
    count: result.data.length,
    data: result.data.map((coin) => ({
      id: coin.id,
      name: coin.name,
      symbol: coin.symbol,
      price_usd: coin.quotes?.[0]?.price ?? null,
    })),
  };
}

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
    const seconds = {
      "1m": 60,
      "5m": 300,
      "15m": 900,
      "30m": 1800,
      "1h": 3600,
      "4h": 14400,
      "8h": 28800,
      "1d": 86400,
      "1w": 604800,
    }[interval];

    // Minta maksimum sekitar 250 candle untuk indikator.
    const start = end - seconds * 250;

    const endpoint =
      `https://contract.mexc.com/api/v1/contract/kline/${symbol}` +
      `?interval=${intervals[interval]}&start=${start}&end=${end}`;

    const response = await fetch(endpoint, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      return json({
        success: false,
        error: "MEXC candle request failed.",
        provider_status: response.status,
        symbol,
        interval,
      }, 502);
    }

    const result = await response.json();

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
      }, 502);
    }

    const raw = result.data;
    const candles = raw.time.map((time, i) => ({
      time: Number(time),
      open: Number(raw.open[i]),
      high: Number(raw.high[i]),
      low: Number(raw.low[i]),
      close: Number(raw.close[i]),
      volume: Number(raw.vol[i]),
    })).filter((c) =>
      Number.isFinite(c.time) &&
      Number.isFinite(c.open) &&
      Number.isFinite(c.high) &&
      Number.isFinite(c.low) &&
      Number.isFinite(c.close) &&
      Number.isFinite(c.volume)
    ).sort((a, b) => a.time - b.time);

    if (candles.length === 0) {
      return json({
        success: false,
        error: "MEXC returned no usable candles.",
        symbol,
        interval,
      }, 502);
    }

    // Hindari memasukkan candle yang belum selesai ke analisis.
    const candleDuration = seconds;
    const completedCandles = candles.filter(
      (c) => c.time + candleDuration <= end
    );

    if (completedCandles.length === 0) {
      return json({
        success: false,
        error: "No completed candles available.",
        symbol,
        interval,
      }, 502);
    }

    const analysis = analyzeCandles(completedCandles);
    const latestCandle =
      completedCandles[completedCandles.length - 1];

    return json({
      success: true,
      name: "Crypto Research AI",
      provider: "MEXC Futures",
      symbol,
      interval,
      timestamp: new Date().toISOString(),
      candleCount: completedCandles.length,
      latestCandle,
      candles: completedCandles,
      analysis,
      dataLimitations: [
        "Indikator dihitung dari candle yang dikembalikan MEXC.",
        "Candle terbaru yang belum selesai dikeluarkan dari analisis.",
        "Data historis dan kelengkapan candle bergantung pada respons exchange.",
        "Belum mencakup funding rate, open interest, atau liquidation heatmap.",
        "Hasil indikator bukan probabilitas keberhasilan trading.",
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
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
        service: "crypto-research-ai",
        version: "2.0.0",
        timestamp: new Date().toISOString(),
        endpoints: [
          "/health",
          "/api/market",
          "/api/technicals?symbol=BTC_USDT&interval=15m",
        ],
      });
    }

    if (url.pathname === "/api/market") {
      try {
        return json(await getMarket());
      } catch (error) {
        return json({
          success: false,
          error: "Unable to fetch market data.",
          message: String(error),
        }, 502);
      }
    }

    if (url.pathname === "/api/technicals") {
      return getTechnicals(url);
    }

    return env.ASSETS.fetch(request);
  },
};
