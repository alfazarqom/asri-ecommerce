import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

function response(status: number, body: Record<string, unknown>) {
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
    return response(405, { error: "method_not_allowed" });
  }

  try {
    const raw = await request.text();
    if (raw.length > 32_000) {
      return response(413, { error: "request_too_large" });
    }
    const body = JSON.parse(raw) as Record<string, unknown>;
    const customer = body.customer && typeof body.customer === "object"
      ? body.customer as Record<string, unknown>
      : {};
    const items = Array.isArray(body.items) ? body.items : [];
    const requestKey = typeof body.request_key === "string"
      ? body.request_key
      : "";
    const firstName = typeof customer.name === "string"
      ? customer.name.trim()
      : "";
    const email = typeof customer.email === "string"
      ? customer.email.trim()
      : "";
    const phone = typeof customer.phone === "string"
      ? customer.phone.trim()
      : "";
    const address = typeof customer.address === "string"
      ? customer.address.trim()
      : "";

    if (
      !requestKey || firstName.length < 2 || email.length > 255 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      phone.length < 8 || address.length < 8 || items.length < 1 ||
      items.length > 50
    ) {
      return response(400, { error: "invalid_order_input" });
    }

    const normalizedItems = items.map((item) => {
      const row = item && typeof item === "object"
        ? item as Record<string, unknown>
        : {};
      return {
        product_id: String(row.product_id ?? ""),
        quantity: Number(row.quantity),
      };
    });
    if (
      normalizedItems.some((item) =>
        !item.product_id || !Number.isInteger(item.quantity) ||
        item.quantity < 1 || item.quantity > 99
      )
    ) {
      return response(400, { error: "invalid_order_items" });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const shippingAddress = {
      address,
      recipientName: firstName,
      phone,
      email,
      city: typeof customer.city === "string"
        ? customer.city.trim().slice(0, 100)
        : "",
      postalCode: typeof customer.postal_code === "string"
        ? customer.postal_code.trim().slice(0, 20)
        : "",
      countryCode: "ID",
    };

    const { data, error } = await supabase.rpc("create_asri_order", {
      p_request_key: requestKey,
      p_customer_first_name: firstName,
      p_customer_email: email,
      p_customer_phone: phone,
      p_shipping_address: shippingAddress,
      p_items: normalizedItems,
    });
    if (error) {
      const stockOrProduct = /stock|product|unavailable|not found/i.test(
        error.message,
      );
      return response(stockOrProduct ? 409 : 400, {
        error: stockOrProduct
          ? "product_or_stock_unavailable"
          : "order_creation_failed",
      });
    }
    return response(201, data as Record<string, unknown>);
  } catch {
    return response(400, { error: "invalid_request" });
  }
});
