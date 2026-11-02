import { AlertCircle, ArrowRight, PackageOpen, RefreshCw, ShoppingBag } from "lucide-react";
import { Link } from "react-router-dom";

export function EmptyState({ title, description, action, to = "/products", icon = "bag" }: { title: string; description: string; action?: string; to?: string; icon?: "bag" | "package" }) {
  const Icon = icon === "package" ? PackageOpen : ShoppingBag;
  return <div className="empty-state"><span className="empty-icon"><Icon size={28} strokeWidth={1.5} /></span><h2>{title}</h2><p>{description}</p>{action ? <Link className="button button-primary" to={to}>{action}<ArrowRight size={16} /></Link> : null}</div>;
}
export function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return <div className="error-state" role="alert"><AlertCircle size={24} /><h3>Katalog belum tersedia</h3><p>{message}</p><button className="button button-secondary" onClick={retry}><RefreshCw size={16} /> Coba lagi</button></div>;
}
export function ProductSkeletons() {
  return <div className="product-grid" aria-label="Memuat produk">{Array.from({ length: 6 }, (_, i) => <div className="skeleton-card" key={i}><div className="skeleton skeleton-image" /><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line short" /><div className="skeleton skeleton-line price" /></div>)}</div>;
}
