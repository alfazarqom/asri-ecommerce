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

export interface CreatedPayment {
  merchant_order_id: string;
  reference: string | null;
  payment_url: string;
  status: string;
}

export async function createPayment(merchantOrderId: string): Promise<CreatedPayment> {
  const baseUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "");
  if (!baseUrl) throw new Error("Konfigurasi backend belum tersedia.");
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error("Konfigurasi akses backend belum tersedia.");
  const response = await fetch(`${baseUrl}/functions/v1/create-payment`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: anonKey,
      authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ merchant_order_id: merchantOrderId }),
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof body.payment_url !== "string") {
    const messages: Record<string, string> = {
      order_not_payable: "Pesanan tidak lagi dapat dibayar.",
      order_expired: "Batas waktu pembayaran pesanan telah berakhir.",
      invoice_creation_already_started: "Invoice sedang diproses. Coba muat ulang beberapa saat lagi.",
    };
    throw new Error(messages[String(body.error)] || "Invoice pembayaran belum dapat dibuat.");
  }
  return body as unknown as CreatedPayment;
}

export interface TrackedOrder {
  order: {
    merchant_order_id: string;
    status: string;
    payment_status: string;
    total_amount: number;
    created_at: string;
    expires_at: string | null;
  };
  items: Array<{ product_name: string; quantity: number; unit_price: number }>;
}

export async function trackOrder(merchantOrderId: string): Promise<TrackedOrder> {
  const baseUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "");
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!baseUrl || !anonKey) throw new Error("Konfigurasi backend belum tersedia.");
  const response = await fetch(`${baseUrl}/functions/v1/order-tracking`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: anonKey,
      authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ merchant_order_id: merchantOrderId }),
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const messages: Record<string, string> = {
      order_not_found: "Nomor pesanan tidak ditemukan.",
      rate_limit_exceeded: "Terlalu banyak percobaan. Coba lagi beberapa saat.",
    };
    throw new Error(messages[String(body.error)] || "Status pesanan belum dapat dimuat.");
  }
  return body as unknown as TrackedOrder;
}
