import { useEffect } from "react";
import { BrowserRouter, Route, Routes, Link } from "react-router-dom";
import { AppShell, StandaloneLayout, ToastHost } from "./components/Shell";
import { HomePage, ProductsPage, SearchPage, WishlistPage, OrdersPage, ProfilePage } from "./pages/StorePages";
import {
  ProductDetailPage, ProductReviewsPage, ProductQuestionsPage, RelatedProductsPage,
  CartPage, CheckoutPage, AddressPage, ShippingPage, PaymentPage, PaymentReturnPage,
  OrderDetailPage, OrderTrackingPage
} from "./pages/StandalonePages";
import { fetchProducts } from "./lib/products";
import { useStore } from "./store/useStore";

function NotFound() {
  return <div className="page-container not-found"><span className="eyebrow">404 / NOT FOUND</span><h1>Halaman tidak ditemukan</h1><p>Halaman yang kamu cari mungkin sudah dipindahkan.</p><Link to="/" className="button button-primary">Kembali ke beranda</Link></div>;
}

function AppRoutes() {
  useEffect(() => {
    const controller = new AbortController();
    useStore.getState().setProductsLoading(true);
    fetchProducts(controller.signal)
      .then(products => useStore.getState().setProducts(products))
      .catch(error => {
        if (error instanceof Error && error.name === "AbortError") return;
        useStore.getState().setProductsError(error instanceof Error ? error.message : "Katalog belum dapat dimuat.");
      });
    return () => controller.abort();
  }, []);

  return <>
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="wishlist" element={<WishlistPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="profile" element={<ProfilePage />} />
      </Route>
      <Route element={<StandaloneLayout />}>
        <Route path="product/:productId" element={<ProductDetailPage />} />
        <Route path="product/:productId/reviews" element={<ProductReviewsPage />} />
        <Route path="product/:productId/questions" element={<ProductQuestionsPage />} />
        <Route path="product/:productId/related" element={<RelatedProductsPage />} />
        <Route path="cart" element={<CartPage />} />
        <Route path="checkout" element={<CheckoutPage />} />
        <Route path="address" element={<AddressPage />} />
        <Route path="shipping" element={<ShippingPage />} />
        <Route path="payment" element={<PaymentPage />} />
        <Route path="payment-return" element={<PaymentReturnPage />} />
        <Route path="order/:orderId" element={<OrderDetailPage />} />
        <Route path="order-tracking" element={<OrderTrackingPage />} />
        <Route path="order-tracking/:orderId" element={<OrderTrackingPage />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
    <ToastHost />
  </>;
}

export default function App() {
  return <BrowserRouter><AppRoutes /></BrowserRouter>;
}
