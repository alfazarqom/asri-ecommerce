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
  const name = stringValue(first(row, ["name", "product_name", "title", "nama_produk"]), "Produk");
  const price = numberValue(first(row, ["price", "selling_price", "harga"]), 0);
  const originalPrice = numberValue(first(row, ["original_price", "compare_at_price", "regular_price", "harga_asli"]), 0);
  const image = stringValue(first(row, ["image_url", "image", "thumbnail", "main_image", "image_link", "photo", "product_image"]));
  const extras = imageList(first(row, ["additional_image_link", "images", "image_urls", "gallery"]));
  const images = [...new Set([image, ...extras].filter(Boolean))];
  const availabilityValue = first(row, ["availability", "is_available", "available", "status"]);
  const availability = typeof availabilityValue === "boolean"
    ? availabilityValue
    : ["in stock", "available", "active", "true", "1"].includes(stringValue(availabilityValue, "available").toLowerCase());
  const stock = numberValue(first(row, ["stock", "quantity", "stock_quantity", "inventory"]), 0);
  const discount = numberValue(first(row, ["discount_percentage", "discount"]), 0);
  const slug = stringValue(first(row, ["slug"]), name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""));
  return {
    id, name, slug, description: stringValue(first(row, ["description", "short_description", "detail"])),
    price, originalPrice: originalPrice > price ? originalPrice : undefined,
    discountPercentage: discount > 0 ? discount : undefined,
    image: images[0], images,
    category: stringValue(first(row, ["category", "category_name", "product_type", "type"]), "Koleksi"),
    availability, stock, sku: stringValue(row.sku), raw: row
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
