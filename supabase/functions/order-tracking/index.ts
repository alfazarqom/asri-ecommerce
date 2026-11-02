import { createClient } from "@supabase/supabase-js";
import { sha256Hex } from "../_shared/duitku.ts";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  try {
    const body = await request.json() as Record<string, unknown>;
    const merchantOrderId = typeof body.merchant_order_id === "string"
      ? body.merchant_order_id.trim()
      : "";
    if (!/^ASRI-[A-F0-9]{32}$/.test(merchantOrderId)) {
      return jsonResponse(400, { error: "invalid_merchant_order_id" });
    }

    const forwardedFor = request.headers.get("x-forwarded-for");
    const clientIp = request.headers.get("cf-connecting-ip")?.trim() ||
      (forwardedFor
        ? forwardedFor.split(",").map((part) => part.trim()).filter(Boolean).at(-1)
        : "");
    if (!clientIp) {
      return jsonResponse(400, { error: "client_ip_unavailable" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(503, { error: "tracking_service_unavailable" });
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const rateKeys = [
      await sha256Hex("order-tracking-ip|" + clientIp),
      await sha256Hex("order-tracking-order|" + clientIp + "|" + merchantOrderId),
    ];
    const limits = [20, 5];
    for (let index = 0; index < rateKeys.length; index++) {
      const { data: allowed, error } = await supabase.rpc(
        "consume_asri_rate_limit",
        {
          p_key_hash: rateKeys[index],
          p_max_requests: limits[index],
          p_window_seconds: 60,
        },
      );
      if (error) {
        return jsonResponse(503, { error: "rate_limit_unavailable" });
      }
      if (allowed !== true) {
        return jsonResponse(429, { error: "rate_limit_exceeded" });
      }
    }

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("merchant_order_id, status, payment_status, total_amount, created_at, expires_at")
      .eq("merchant_order_id", merchantOrderId)
      .maybeSingle();

    if (orderError) {
      return jsonResponse(500, { error: "tracking_lookup_failed" });
    }
    if (!order) {
      return jsonResponse(404, { error: "order_not_found" });
    }

    const { data: items, error: itemsError } = await supabase
      .from("order_items")
      .select("product_name, quantity, unit_price")
      .eq("order_id", (
        await supabase
          .from("orders")
          .select("id")
          .eq("merchant_order_id", merchantOrderId)
          .single()
      ).data?.id ?? "");

    if (itemsError) {
      return jsonResponse(500, { error: "tracking_items_lookup_failed" });
    }

    return jsonResponse(200, {
      order: {
        merchant_order_id: order.merchant_order_id,
        status: order.status,
        payment_status: order.payment_status,
        total_amount: order.total_amount,
        created_at: order.created_at,
        expires_at: order.expires_at,
      },
      items: (items ?? []).map((item) => ({
        product_name: item.product_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
      })),
    });
  } catch {
    return jsonResponse(400, { error: "invalid_request" });
  }
});
