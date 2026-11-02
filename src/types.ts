export interface Product {
  id: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  originalPrice?: number;
  discountPercentage?: number;
  image?: string;
  images: string[];
  category?: string;
  availability: boolean;
  availabilityLabel: string;
  stock: number | null;
  sku?: string;
  raw: Record<string, unknown>;
}
export interface CartLine { product: Product; quantity: number }
export type ToastKind = "success" | "error" | "info";
export interface ToastMessage { id: number; message: string; kind: ToastKind }
