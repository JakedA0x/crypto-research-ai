
export default {
  async fetch(request) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    let responseData;

    if (url.pathname === "/") {
      responseData = {
        success: true,
        name: "Crypto Research AI",
        status: "online",
        version: "1.0.0",
        message: "Backend API is running",
        endpoints: ["/health", "/api/market"]
      };
    } else if (url.pathname === "/health") {
      responseData = {
        success: true,
        status: "healthy",
        service: "crypto-research-ai",
        timestamp: new Date().toISOString()
      };
    } else if (url.pathname === "/api/market") {
      responseData = {
        success: true,
        message: "Market endpoint is ready",
        data: [],
        note: "Live market data integration will be added next."
      };
    } else {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Endpoint not found"
        }),
        {
          status: 404,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        }
      );
    }

    return new Response(JSON.stringify(responseData, null, 2), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
};
