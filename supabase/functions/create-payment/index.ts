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
    if (!/^ASRI-[A-Z0-9-]{12,40}$/.test(merchantOrderId)) {
      return jsonResponse(400, { error: "invalid_merchant_order_id" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const internalSecret = Deno.env.get("DUITKU_INTERNAL_API_SECRET");
    if (!supabaseUrl || !serviceRoleKey || !internalSecret) {
      return jsonResponse(503, { error: "payment_service_unavailable" });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const forwardedFor = request.headers.get("x-forwarded-for");
    const clientIp = request.headers.get("cf-connecting-ip")?.trim() ||
      (forwardedFor ? forwardedFor.split(",").map((part) => part.trim()).filter(Boolean).at(-1) : "");
    if (!clientIp) {
      return jsonResponse(400, { error: "client_ip_unavailable" });
    }
    const { data: rateAllowed, error: rateError } = await supabase.rpc(
      "consume_asri_rate_limit",
      {
        p_key_hash: await sha256Hex("create-payment|" + clientIp),
        p_max_requests: 5,
        p_window_seconds: 60,
      },
    );
    if (rateError) {
      return jsonResponse(503, { error: "rate_limit_unavailable" });
    }
    if (rateAllowed !== true) {
      return jsonResponse(429, { error: "rate_limit_exceeded" });
    }

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("merchant_order_id, status, payment_status, expires_at")
      .eq("merchant_order_id", merchantOrderId)
      .maybeSingle();

    if (orderError) {
      return jsonResponse(500, { error: "order_lookup_failed" });
    }
    if (!order) {
      return jsonResponse(404, { error: "order_not_found" });
    }
    if (
      order.status !== "pending_payment" ||
      order.payment_status !== "pending"
    ) {
      return jsonResponse(409, { error: "order_not_payable" });
    }
    if (
      !order.expires_at ||
      new Date(order.expires_at).getTime() <= Date.now()
    ) {
      return jsonResponse(410, { error: "order_expired" });
    }

    const invoiceResponse = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/functions/v1/duitku-create-invoice`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-secret": internalSecret,
        },
        body: JSON.stringify({ merchant_order_id: merchantOrderId }),
        signal: AbortSignal.timeout(25_000),
      },
    );
    const invoiceBody = await invoiceResponse.json().catch(() => ({})) as Record<string, unknown>;
    if (!invoiceResponse.ok) {
      return jsonResponse(invoiceResponse.status, {
        error: typeof invoiceBody.error === "string"
          ? invoiceBody.error
          : "invoice_creation_failed",
      });
    }
    if (
      typeof invoiceBody.payment_url !== "string" ||
      typeof invoiceBody.status !== "string"
    ) {
      return jsonResponse(502, { error: "invalid_invoice_response" });
    }

    return jsonResponse(200, {
      merchant_order_id: merchantOrderId,
      reference: typeof invoiceBody.reference === "string"
        ? invoiceBody.reference
        : null,
      payment_url: invoiceBody.payment_url,
      status: invoiceBody.status,
    });
  } catch {
    return jsonResponse(500, { error: "payment_creation_failed" });
  }
});
