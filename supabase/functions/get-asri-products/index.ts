import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function jsonResponse(status: number, body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function parseNonNegativeInteger(value: string | null, fallback: number): number | null {
  if (value === null || value.trim() === "") return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { status: 204, headers: corsHeaders });
  }

  if (request.method !== "GET") {
    return jsonResponse(405, { error: "method_not_allowed" }, { Allow: "GET, OPTIONS" });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Missing Supabase server environment configuration");
      return jsonResponse(500, { error: "server_configuration_error" });
    }

    const url = new URL(request.url);
    const limit = parseNonNegativeInteger(url.searchParams.get("limit"), 1000);
    const offset = parseNonNegativeInteger(url.searchParams.get("offset"), 0);

    if (limit === null || limit < 1 || limit > 1000) {
      return jsonResponse(400, { error: "invalid_limit", message: "limit must be an integer from 1 to 1000" });
    }
    if (offset === null || offset > 1000000) {
      return jsonResponse(400, { error: "invalid_offset", message: "offset must be an integer from 0 to 1000000" });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("Could not read products:", error.message);
      return jsonResponse(500, { error: "products_fetch_failed" });
    }

    // The successful response is a JSON array of complete products rows.
    return jsonResponse(200, data ?? [], {
      "Cache-Control": "public, max-age=30, stale-while-revalidate=60",
    });
  } catch (error) {
    console.error("Unexpected get-asri-products error:", error instanceof Error ? error.message : "unknown");
    return jsonResponse(500, { error: "internal_server_error" });
  }
});
