import type { CartLine } from "../types";

export interface CreateOrderInput {
  name: string;
  email: string;
  phone: string;
  address: string;
}

export interface CreatedOrder {
  order_id: string;
  status: string;
  payment_status: string;
  subtotal_amount: number;
  shipping_amount: number;
  total_amount: number;
  expires_at: string;
  duplicate: boolean;
}

export async function createOrder(customer: CreateOrderInput, cart: CartLine[], requestKey: string): Promise<CreatedOrder> {
  const baseUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "");
  if (!baseUrl) throw new Error("Konfigurasi backend belum tersedia.");
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (anonKey) { headers.apikey = anonKey; headers.authorization = `Bearer ${anonKey}`; }
  const response = await fetch(`${baseUrl}/functions/v1/create-order`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      request_key: requestKey,
      customer,
      items: cart.map(({ product, quantity }) => ({ product_id: product.id, quantity })),
    }),
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const messages: Record<string, string> = {
      product_or_stock_unavailable: "Ada produk yang sudah tidak tersedia atau stoknya berubah. Periksa kembali keranjang.",
      invalid_order_input: "Periksa kembali informasi pelanggan dan alamat pengiriman.",
    };
    throw new Error(messages[String(body.error)] || "Pesanan belum dapat dibuat. Silakan coba lagi.");
  }
  return body as unknown as CreatedOrder;
}
