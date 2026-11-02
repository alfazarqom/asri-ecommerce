import type { Product } from "../types";

const first = (row: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
};
const numberValue = (value: unknown, fallback = 0) => {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
};
const stringValue = (value: unknown, fallback = "") => typeof value === "string" ? value : value == null ? fallback : String(value);
const imageList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(item => typeof item === "string" ? item : "").filter(Boolean);
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string");
    } catch { return value.trim() ? [value] : []; }
  }
  return [];
};

export function normalizeProduct(input: unknown): Product {
  const row = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const id = stringValue(first(row, ["id", "product_id", "uuid", "sku"]), crypto.randomUUID());
  const name = stringValue(first(row, ["title", "name", "product_name", "nama_produk"]), "Produk");
  const basePrice = numberValue(first(row, ["price", "selling_price", "harga"]), 0);
  const salePrice = numberValue(first(row, ["sale_price"]), 0);
  const price = salePrice > 0 && salePrice < basePrice ? salePrice : basePrice;
  const explicitOriginal = numberValue(first(row, ["original_price", "compare_at_price", "regular_price", "harga_asli"]), 0);
  const originalPrice = salePrice > 0 && salePrice < basePrice ? basePrice : explicitOriginal > price ? explicitOriginal : undefined;
  const rawDiscount = numberValue(first(row, ["discount_percentage", "discount"]), 0);
  const discountPercentage = rawDiscount > 0 ? rawDiscount : originalPrice ? Math.round((1 - price / originalPrice) * 100) : undefined;
  const image = stringValue(first(row, ["image_link", "image_url", "image", "thumbnail", "main_image", "photo", "product_image"]));
  const extras = imageList(first(row, ["additional_image_link", "images", "image_urls", "gallery"]));
  const images = [...new Set([image, ...extras].filter(Boolean))];
  const availabilityStatus = stringValue(first(row, ["availability", "is_available", "available", "status"]), "in stock").toLowerCase();
  const availability = ["in stock", "preorder", "available for order", "available", "active", "true", "1"].includes(availabilityStatus);
  const availabilityLabels: Record<string, string> = {
    "in stock": "Tersedia", preorder: "Preorder", "available for order": "Dapat dipesan",
    available: "Tersedia", active: "Tersedia", "out of stock": "Habis", discontinued: "Tidak tersedia"
  };
  const inventoryValue = first(row, ["inventory", "stock", "quantity", "stock_quantity"]);
  const stock = inventoryValue === undefined ? null : numberValue(inventoryValue, 0);
  const slug = stringValue(first(row, ["slug"]), name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""));
  return {
    id, name, slug, description: stringValue(first(row, ["description", "short_description", "detail"])),
    price, originalPrice, discountPercentage,
    image: images[0], images,
    category: stringValue(first(row, ["product_type", "category", "category_name", "type"]), "Koleksi"),
    availability, availabilityLabel: availabilityLabels[availabilityStatus] || availabilityStatus,
    stock, sku: stringValue(row.sku), raw: row
  };
}

export async function fetchProducts(signal?: AbortSignal): Promise<Product[]> {
  const baseUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "");
  const functionName = import.meta.env.VITE_PRODUCTS_FUNCTION || "get-asri-products";
  if (!baseUrl) throw new Error("Konfigurasi katalog belum tersedia. Tambahkan VITE_SUPABASE_URL pada environment.");
  const headers: Record<string, string> = {};
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (anonKey) headers.apikey = anonKey;
  const response = await fetch(`${baseUrl}/functions/v1/${functionName}?limit=1000&offset=0`, { headers, signal });
  if (!response.ok) throw new Error(response.status === 404 ? "Endpoint katalog tidak ditemukan." : "Katalog belum dapat dimuat. Coba lagi beberapa saat.");
  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new Error("Format respons katalog tidak sesuai.");
  return body.map(normalizeProduct);
}
