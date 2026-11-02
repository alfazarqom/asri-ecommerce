import { useEffect } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Heart, Home, Menu, Package, Search, ShoppingBag, UserRound, X } from "lucide-react";
import { useStore } from "../store/useStore";

const navItems = [
  { to: "/", label: "Beranda", icon: Home, end: true },
  { to: "/products", label: "Produk", icon: Menu },
  { to: "/wishlist", label: "Wishlist", icon: Heart },
  { to: "/orders", label: "Pesanan", icon: Package },
  { to: "/profile", label: "Profil", icon: UserRound }
];

export function Header() {
  const count = useStore(state => state.cart.reduce((sum, line) => sum + line.quantity, 0));
  const navigate = useNavigate();
  return <header className="site-header">
    <div className="header-inner">
      <Link to="/" className="brand-mark" aria-label="ASRI Collection beranda"><span className="brand-symbol">A</span><span className="brand-copy"><strong>ASRI</strong><small>COLLECTION</small></span></Link>
      <button className="desktop-search" onClick={() => navigate("/search")}><Search size={17} /><span>Cari produk favoritmu</span><kbd>⌘ K</kbd></button>
      <div className="header-actions">
        <button className="icon-button search-trigger" onClick={() => navigate("/search")} aria-label="Cari produk"><Search /></button>
        <button className="icon-button" onClick={() => navigate("/cart")} aria-label={`Keranjang, ${count} item`}><ShoppingBag />{count > 0 ? <span className="cart-count">{count}</span> : null}</button>
        <button className="icon-button profile-trigger" onClick={() => navigate("/profile")} aria-label="Profil"><UserRound /></button>
      </div>
    </div>
  </header>;
}

export function BottomNavigation() {
  const location = useLocation();
  const hidden = location.pathname !== "/" && ["/products", "/search", "/wishlist", "/orders", "/profile"].every(path => !location.pathname.startsWith(path));
  if (hidden) return null;
  return <nav className="bottom-navigation" aria-label="Navigasi utama">
    {navItems.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => `bottom-nav-item ${isActive ? "active" : ""}`} aria-label={label}><Icon size={20} strokeWidth={1.8} /><span>{label}</span></NavLink>)}
  </nav>;
}

export function AppShell() {
  return <div className="app-shell"><Header /><main className="app-main"><div className="main-scroll"><Outlet /></div></main><BottomNavigation /></div>;
}

export function StandaloneLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const title = location.pathname.startsWith("/cart") ? "Keranjang" : location.pathname.startsWith("/checkout") ? "Checkout" : location.pathname.startsWith("/payment") ? "Pembayaran" : "ASRI Collection";
  return <div className="standalone-shell">
    <header className="standalone-header"><button className="icon-button" onClick={() => navigate(-1)} aria-label="Kembali"><X size={20} /></button><strong>{title}</strong><Link to="/" className="standalone-brand">ASRI</Link></header>
    <main className="standalone-content"><Outlet /></main>
  </div>;
}

export function ToastHost() {
  const toast = useStore(state => state.toast);
  const dismiss = useStore(state => state.dismissToast);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(dismiss, 3000); return () => window.clearTimeout(timer); }, [toast, dismiss]);
  if (!toast) return null;
  return <div className={`toast toast-${toast.kind}`} role="status" aria-live="polite"><span>{toast.message}</span><button onClick={dismiss} aria-label="Tutup notifikasi"><X size={16} /></button></div>;
}
