
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
      "Cache-Control": "public, max-age=30",
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
        version: "1.3.0",
        provider: "CoinMarketCap",
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
        const apiUrl =
          "https://pro-api.coinmarketcap.com/public-api/v2/simple/price" +
          "?symbol=BTC,ETH,SOL&convert=USD";

        const response = await fetch(apiUrl, {
          headers: { Accept: "application/json" },
        });

        if (!response.ok) {
          return json({
            success: false,
            error: "CoinMarketCap request failed",
            provider_status: response.status,
          }, 502);
        }

        const result = await response.json();

        if (result.status?.error_code !== 0 || !Array.isArray(result.data)) {
          return json({
            success: false,
            error: "Invalid market data response",
            provider_message: result.status?.error_message ?? null,
          }, 502);
        }

        const data = result.data.map((coin) => ({
          id: coin.id,
          name: coin.name,
          symbol: coin.symbol,
          price_usd: coin.quotes?.[0]?.price ?? null,
        }));

        return json({
          success: true,
          provider: "CoinMarketCap",
          timestamp: result.status.timestamp,
          currency: "USD",
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
