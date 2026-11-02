import { useState } from "react";
import { Eye, Heart, ShoppingBag } from "lucide-react";
import { Link } from "react-router-dom";
import type { Product } from "../types";
import { formatRupiah } from "../lib/format";
import { useStore } from "../store/useStore";
import { Modal } from "./Overlays";

export function ProductCard({ product }: { product: Product }) {
  const { wishlist, toggleWishlist, addToCart, notify } = useStore();
  const [quickViewOpen, setQuickViewOpen] = useState(false);
  const saved = wishlist.includes(product.id);
  const canPurchase = product.availability && product.stock !== 0;
  return <article className="product-card">
    <div className="product-image-wrap">
      <Link to={`/product/${product.id}`} aria-label={`Lihat ${product.name}`}>
        {product.image ? <img className="product-image" src={product.image} alt={product.name} loading="lazy" /> : <div className="image-placeholder"><ShoppingBag size={28} strokeWidth={1.5} /><span>ASRI Collection</span></div>}
      </Link>
      {product.discountPercentage ? <span className="discount-badge">-{Math.round(product.discountPercentage)}%</span> : null}
      <button className={`icon-button wishlist-button ${saved ? "is-saved" : ""}`} onClick={() => toggleWishlist(product.id)} aria-label={saved ? "Hapus dari wishlist" : "Tambah ke wishlist"}><Heart size={18} fill={saved ? "currentColor" : "none"} /></button>
      <button className="icon-button quick-view-button" onClick={() => setQuickViewOpen(true)} aria-label={`Lihat cepat ${product.name}`}><Eye size={17} /></button>
    </div>
    <div className="product-card-body">
      <span className="product-category">{product.category}</span>
      <Link className="product-name" to={`/product/${product.id}`}>{product.name}</Link>
      <div className="price-row"><strong>{formatRupiah(product.price)}</strong>{product.originalPrice ? <del>{formatRupiah(product.originalPrice)}</del> : null}</div>
      <div className="product-card-footer">
        <span className={canPurchase ? "stock-ok" : "stock-out"}>{product.availabilityLabel}{product.stock !== null ? ` · Stok ${product.stock}` : ""}</span>
        <button className="quick-add" disabled={!canPurchase} onClick={() => { addToCart(product); notify("Ditambahkan ke keranjang"); }} aria-label={`Tambah ${product.name} ke keranjang`}><ShoppingBag size={16} /></button>
      </div>
    </div>
    {quickViewOpen ? <Modal title="Quick view" onClose={() => setQuickViewOpen(false)} className="quick-view-modal"><div className="quick-view-content">{product.image ? <img src={product.image} alt={product.name} /> : <div className="image-placeholder"><ShoppingBag /></div>}<div><span className="eyebrow">{product.category}</span><h3>{product.name}</h3><strong>{formatRupiah(product.price)}</strong><p>{product.description || "Pilihan ASRI Collection."}</p><span className={canPurchase ? "stock-ok" : "stock-out"}>{product.availabilityLabel}{product.stock !== null ? ` · Stok ${product.stock}` : ""}</span><div className="quick-view-actions"><button className="button button-primary" disabled={!canPurchase} onClick={() => { addToCart(product); notify("Ditambahkan ke keranjang"); setQuickViewOpen(false); }}><ShoppingBag size={16} /> Tambah ke keranjang</button><Link className="button button-secondary" to={`/product/${product.id}`}>Detail produk</Link></div></div></div></Modal> : null}
  </article>;
}
