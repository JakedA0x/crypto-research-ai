
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
        version: "1.1.0",
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
        const ids = "bitcoin,ethereum,solana";
        const apiUrl =
          "https://api.coingecko.com/api/v3/simple/price" +
          `?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;

        const response = await fetch(apiUrl, {
          headers: { Accept: "application/json" },
        });

        if (!response.ok) {
          return json({
            success: false,
            error: "Market data provider returned an error",
            provider_status: response.status,
          }, 502);
        }

        const prices = await response.json();

        const coins = [
          { id: "bitcoin", symbol: "BTC", name: "Bitcoin" },
          { id: "ethereum", symbol: "ETH", name: "Ethereum" },
          { id: "solana", symbol: "SOL", name: "Solana" },
        ];

        const data = coins.map((coin) => ({
          ...coin,
          price_usd: prices[coin.id]?.usd ?? null,
          change_24h_percent:
            prices[coin.id]?.usd_24h_change ?? null,
        }));

        return json({
          success: true,
          provider: "CoinGecko",
          timestamp: new Date().toISOString(),
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
