import { Heart, ShoppingBag } from "lucide-react";
import { Link } from "react-router-dom";
import type { Product } from "../types";
import { formatRupiah } from "../lib/format";
import { useStore } from "../store/useStore";

export function ProductCard({ product }: { product: Product }) {
  const { wishlist, toggleWishlist, addToCart, notify } = useStore();
  const saved = wishlist.includes(product.id);
  return <article className="product-card">
    <div className="product-image-wrap">
      <Link to={`/product/${product.id}`} aria-label={`Lihat ${product.name}`}>
        {product.image ? <img className="product-image" src={product.image} alt={product.name} loading="lazy" /> : <div className="image-placeholder"><ShoppingBag size={28} strokeWidth={1.5} /><span>ASRI Collection</span></div>}
      </Link>
      {product.discountPercentage ? <span className="discount-badge">-{Math.round(product.discountPercentage)}%</span> : null}
      <button className={`icon-button wishlist-button ${saved ? "is-saved" : ""}`} onClick={() => toggleWishlist(product.id)} aria-label={saved ? "Hapus dari wishlist" : "Tambah ke wishlist"}><Heart size={18} fill={saved ? "currentColor" : "none"} /></button>
    </div>
    <div className="product-card-body">
      <span className="product-category">{product.category}</span>
      <Link className="product-name" to={`/product/${product.id}`}>{product.name}</Link>
      <div className="price-row"><strong>{formatRupiah(product.price)}</strong>{product.originalPrice ? <del>{formatRupiah(product.originalPrice)}</del> : null}</div>
      <div className="product-card-footer">
        <span className={product.availability && product.stock > 0 ? "stock-ok" : "stock-out"}>{product.availability && product.stock > 0 ? "Tersedia" : "Habis"}</span>
        <button className="quick-add" disabled={!product.availability || product.stock <= 0} onClick={() => { addToCart(product); notify("Ditambahkan ke keranjang"); }} aria-label={`Tambah ${product.name} ke keranjang`}><ShoppingBag size={16} /></button>
      </div>
    </div>
  </article>;
}
