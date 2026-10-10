
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
      "Cache-Control": "public, max-age=15",
    },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "GET") {
      return json({ success: false, error: "Method not allowed" }, 405);
    }

    if (url.pathname === "/") {
      return json({
        success: true,
        name: "Crypto Research AI",
        status: "online",
        version: "1.2.0",
        provider: "Binance",
        endpoints: ["/health", "/api/market"],
      });
    }

    if (url.pathname === "/health") {
      return json({
        success: true,
        status: "healthy",
        service: "crypto-research-ai",
        timestamp: new Date().toISOString(),
      });
    }

    if (url.pathname === "/api/market") {
      try {
        const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
        const apiUrl =
          "https://api.binance.com/api/v3/ticker/24hr?symbols=" +
          encodeURIComponent(JSON.stringify(symbols));

        const response = await fetch(apiUrl, {
          headers: { Accept: "application/json" },
        });

        if (!response.ok) {
          return json({
            success: false,
            error: "Binance market data request failed",
            provider_status: response.status,
          }, 502);
        }

        const tickers = await response.json();

        const names = {
          BTCUSDT: { symbol: "BTC", name: "Bitcoin" },
          ETHUSDT: { symbol: "ETH", name: "Ethereum" },
          SOLUSDT: { symbol: "SOL", name: "Solana" },
        };

        const data = tickers.map((ticker) => ({
          ...names[ticker.symbol],
          pair: ticker.symbol,
          price_usdt: Number(ticker.lastPrice),
          change_24h_percent: Number(ticker.priceChangePercent),
          high_24h: Number(ticker.highPrice),
          low_24h: Number(ticker.lowPrice),
          volume_24h: Number(ticker.volume),
          quote_volume_24h: Number(ticker.quoteVolume),
          bid_price: Number(ticker.bidPrice),
          ask_price: Number(ticker.askPrice),
        }));

        return json({
          success: true,
          provider: "Binance",
          timestamp: new Date().toISOString(),
          currency: "USDT",
          data,
        });
      } catch (error) {
        return json({
          success: false,
          error: "Unable to fetch market data",
          message: String(error),
        }, 502);
      }
    }

    return json({
      success: false,
      error: "Endpoint not found",
    }, 404);
  },
};
