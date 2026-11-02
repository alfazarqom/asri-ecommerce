import { create } from "zustand";
import type { CartLine, Product, ToastMessage } from "../types";

interface Store {
  products: Product[];
  productsLoading: boolean;
  productsError: string | null;
  cart: CartLine[];
  wishlist: string[];
  toast: ToastMessage | null;
  setProducts: (products: Product[]) => void;
  setProductsLoading: (value: boolean) => void;
  setProductsError: (value: string | null) => void;
  addToCart: (product: Product, quantity?: number) => void;
  updateQuantity: (id: string, quantity: number) => void;
  removeFromCart: (id: string) => void;
  toggleWishlist: (id: string) => void;
  clearCart: () => void;
  notify: (message: string, kind?: ToastMessage["kind"]) => void;
  dismissToast: () => void;
}
export const useStore = create<Store>((set) => ({
  products: [], productsLoading: true, productsError: null, cart: [], wishlist: [], toast: null,
  setProducts: (products) => set({ products, productsLoading: false, productsError: null }),
  setProductsLoading: (value) => set({ productsLoading: value }),
  setProductsError: (value) => set({ productsLoading: false, productsError: value }),
  addToCart: (product, quantity = 1) => set(state => {
    if (!product.availability || product.stock === 0) return state;
    const existing = state.cart.find(line => line.product.id === product.id);
    if (existing) return { cart: state.cart.map(line => line.product.id === product.id ? { ...line, quantity: product.stock === null ? line.quantity + quantity : Math.min(line.quantity + quantity, product.stock) } : line) };
    return { cart: [...state.cart, { product, quantity: product.stock === null ? quantity : Math.min(quantity, product.stock) }] };
  }),
  updateQuantity: (id, quantity) => set(state => ({
    cart: quantity <= 0 ? state.cart.filter(line => line.product.id !== id) : state.cart.map(line => line.product.id === id ? { ...line, quantity: line.product.stock === null ? quantity : Math.min(quantity, line.product.stock) } : line)
  })),
  removeFromCart: (id) => set(state => ({ cart: state.cart.filter(line => line.product.id !== id) })),
  toggleWishlist: (id) => set(state => ({ wishlist: state.wishlist.includes(id) ? state.wishlist.filter(item => item !== id) : [...state.wishlist, id] })),
  clearCart: () => set({ cart: [] }),
  notify: (message, kind = "success") => set({ toast: { id: Date.now(), message, kind } }),
  dismissToast: () => set({ toast: null })
}));
