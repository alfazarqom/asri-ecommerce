import { useMemo, useState } from "react";
import { ArrowRight, ArrowUpDown, Search, SlidersHorizontal, Sparkles, Truck, ShieldCheck, Headphones, X, Package } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ProductCard } from "../components/ProductCard";
import { EmptyState, ErrorState, ProductSkeletons } from "../components/States";
import { SectionTitle } from "../components/SectionTitle";
import { useStore } from "../store/useStore";

export function HomePage() {
  const products = useStore(s => s.products);
  const loading = useStore(s => s.productsLoading);
  const error = useStore(s => s.productsError);
  const reload = async () => { useStore.getState().setProductsLoading(true); try { const { fetchProducts } = await import("../lib/products"); useStore.getState().setProducts(await fetchProducts()); } catch (e) { useStore.getState().setProductsError(e instanceof Error ? e.message : "Terjadi kesalahan."); } };
  const categories = [...new Set(products.map(p => p.category).filter(Boolean))].slice(0, 6);
  return <div className="page-container home-page">
    <section className="hero-banner">
      <div className="hero-content"><span className="eyebrow"><Sparkles size={13} /> THE NEW COLLECTION</span><h1>Elegan dalam<br /><em>setiap detail.</em></h1><p>Temukan pilihan terbaik untuk melengkapi gaya sehari-harimu.</p><Link to="/products" className="button button-light">Jelajahi koleksi <ArrowRight size={16} /></Link></div>
      <div className="hero-art" aria-hidden="true"><div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" /><span className="hero-letter">A</span><span className="hero-caption">ASRI / 2026</span></div>
      <div className="hero-index">01 <span /> 03</div>
    </section>
    <div className="benefit-strip">
      <div><Truck size={19} /><span><strong>Pengiriman aman</strong><small>Ke seluruh Indonesia</small></span></div>
      <div><ShieldCheck size={19} /><span><strong>Belanja nyaman</strong><small>Proses transparan</small></span></div>
      <div><Headphones size={19} /><span><strong>Siap membantu</strong><small>Dukungan pelanggan</small></span></div>
    </div>
    {categories.length > 0 ? <section className="section-block"><SectionTitle title="Jelajahi kategori" subtitle="Pilihan untuk setiap momen" /><div className="category-chips">{categories.map(category => <Link key={category} to={`/products?category=${encodeURIComponent(category || "")}`} className="category-chip"><span>{category?.slice(0, 1).toUpperCase()}</span>{category}</Link>)}</div></section> : null}
    <section className="section-block"><SectionTitle title="Pilihan untukmu" subtitle="Temukan koleksi favorit ASRI" to="/products" />{loading ? <ProductSkeletons /> : error ? <ErrorState message={error} retry={reload} /> : products.length ? <div className="product-grid">{products.slice(0, 8).map(product => <ProductCard key={product.id} product={product} />)}</div> : <EmptyState title="Koleksi sedang disiapkan" description="Produk terbaru akan tampil di sini setelah katalog terhubung." action="Lihat katalog" />}</section>
    <section className="editorial-banner"><div><span className="eyebrow">ASRI COLLECTION</span><h2>Less, but<br /><em>more meaningful.</em></h2><p>Gaya yang sederhana, pilihan yang terasa istimewa.</p><Link to="/products" className="text-link">Temukan koleksi <ArrowRight size={16} /></Link></div><div className="editorial-mark">A<span>.</span></div></section>
  </div>;
}

export function ProductsPage() {
  const products = useStore(s => s.products);
  const loading = useStore(s => s.productsLoading);
  const error = useStore(s => s.productsError);
  const [params, setParams] = useSearchParams();
  const [sort, setSort] = useState("newest");
  const [filterOpen, setFilterOpen] = useState(false);
  const category = params.get("category") || "";
  const categories = [...new Set(products.map(p => p.category).filter(Boolean))];
  const filtered = useMemo(() => {
    const result = products.filter(p => !category || p.category === category);
    if (sort === "price-low") result.sort((a,b) => a.price - b.price);
    if (sort === "price-high") result.sort((a,b) => b.price - a.price);
    if (sort === "name") result.sort((a,b) => a.name.localeCompare(b.name));
    return result;
  }, [products, category, sort]);
  const retry = async () => { useStore.getState().setProductsLoading(true); try { const { fetchProducts } = await import("../lib/products"); useStore.getState().setProducts(await fetchProducts()); } catch (e) { useStore.getState().setProductsError(e instanceof Error ? e.message : "Gagal memuat katalog."); } };
  return <div className="page-container listing-page"><div className="page-heading"><div><span className="eyebrow">DISCOVER ASRI</span><h1>Semua Produk</h1><p>Koleksi pilihan untuk gaya sehari-hari.</p></div><button className="icon-button filter-trigger" onClick={() => setFilterOpen(true)} aria-label="Buka filter"><SlidersHorizontal /></button></div>
    <div className="listing-toolbar"><span>{loading ? "Memuat katalog…" : `${filtered.length} produk`}</span><label className="sort-control"><ArrowUpDown size={15} /><select value={sort} onChange={e => setSort(e.target.value)} aria-label="Urutkan produk"><option value="newest">Terbaru</option><option value="price-low">Harga terendah</option><option value="price-high">Harga tertinggi</option><option value="name">Nama A–Z</option></select></label></div>
    <div className="category-filter-row"><button className={!category ? "filter-chip selected" : "filter-chip"} onClick={() => setParams({})}>Semua</button>{categories.map(c => <button key={c} className={category === c ? "filter-chip selected" : "filter-chip"} onClick={() => setParams(c ? { category: c } : {})}>{c}</button>)}</div>
    {loading ? <ProductSkeletons /> : error ? <ErrorState message={error} retry={retry} /> : filtered.length ? <div className="product-grid">{filtered.map(p => <ProductCard key={p.id} product={p} />)}</div> : <EmptyState title="Produk tidak ditemukan" description="Coba kategori lain atau hapus filter yang dipilih." action="Tampilkan semua produk" to="/products" />}
    {filterOpen ? <div className="overlay-backdrop" role="presentation" onClick={() => setFilterOpen(false)}><section className="bottom-drawer" role="dialog" aria-modal="true" aria-labelledby="filter-title" onClick={e => e.stopPropagation()}><div className="drawer-handle" /><div className="drawer-heading"><h2 id="filter-title">Filter kategori</h2><button className="icon-button" onClick={() => setFilterOpen(false)} aria-label="Tutup filter"><X /></button></div><div className="drawer-options"><button className={!category ? "drawer-option selected" : "drawer-option"} onClick={() => setParams({})}>Semua kategori</button>{categories.map(c => <button key={c} className={category === c ? "drawer-option selected" : "drawer-option"} onClick={() => setParams({ category: c || "" })}>{c}</button>)}</div><button className="button button-primary button-full" onClick={() => setFilterOpen(false)}>Terapkan filter</button></section></div> : null}
  </div>;
}

export function SearchPage() {
  const products = useStore(s => s.products);
  const [query, setQuery] = useState("");
  const results = products.filter(p => `${p.name} ${p.category} ${p.description}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="page-container search-page"><div className="page-heading"><div><span className="eyebrow">FIND YOUR STYLE</span><h1>Cari produk</h1><p>Apa yang sedang kamu cari?</p></div></div><label className="search-field"><Search size={19} /><input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Cari nama atau kategori produk…" /><button onClick={() => setQuery("")} aria-label="Hapus pencarian"><X size={17} /></button></label>{query ? <><div className="listing-toolbar"><span>{results.length} hasil untuk “{query}”</span></div>{results.length ? <div className="product-grid">{results.map(p => <ProductCard key={p.id} product={p} />)}</div> : <EmptyState title="Belum ada hasil" description="Coba kata kunci yang lebih umum." />}</> : <div className="search-hint"><span className="hint-icon"><Search /></span><strong>Mulai pencarianmu</strong><p>Hasil produk akan muncul saat kamu mengetik.</p></div>}</div>;
}

export function WishlistPage() {
  const products = useStore(s => s.products);
  const ids = useStore(s => s.wishlist);
  const saved = products.filter(p => ids.includes(p.id));
  return <div className="page-container"><div className="page-heading"><div><span className="eyebrow">SAVED FOR LATER</span><h1>Wishlist</h1><p>{saved.length} produk tersimpan</p></div></div>{saved.length ? <div className="product-grid">{saved.map(p => <ProductCard key={p.id} product={p} />)}</div> : <EmptyState title="Wishlist masih kosong" description="Simpan produk yang kamu suka dengan menekan ikon hati." action="Jelajahi produk" />}</div>;
}

export function OrdersPage() {
  const [orderId, setOrderId] = useState("");
  const navigate = useNavigate();
  return <div className="page-container orders-page"><div className="page-heading"><div><span className="eyebrow">YOUR PURCHASES</span><h1>Pesanan</h1><p>Lacak pesananmu dengan nomor order.</p></div></div><div className="order-lookup-card"><span className="lookup-icon"><Package /></span><h2>Lacak pesanan</h2><p>Masukkan nomor pesanan yang kamu terima setelah checkout.</p><form onSubmit={e => { e.preventDefault(); if (orderId.trim()) navigate(`/order-tracking/${encodeURIComponent(orderId.trim())}`); }}><label htmlFor="order-id">Nomor pesanan</label><input id="order-id" required value={orderId} onChange={e => setOrderId(e.target.value)} placeholder="Contoh: ASRI-XXXXXXXX" /><button className="button button-primary button-full" type="submit">Lacak pesanan <ArrowRight size={16} /></button></form><small>Riwayat pesanan akan tersedia setelah layanan order terhubung.</small></div></div>;
}

export function ProfilePage() {
  return <div className="page-container profile-page"><div className="page-heading"><div><span className="eyebrow">WELCOME TO ASRI</span><h1>Profil</h1><p>Kelola pengalaman belanjamu.</p></div></div><div className="profile-card"><div className="avatar">A</div><div><strong>Selamat datang di ASRI</strong><span>Belanja sebagai tamu</span></div><span className="guest-badge">GUEST</span></div><div className="profile-menu"><Link to="/orders"><span className="menu-icon"><Package /></span><span><strong>Pesanan saya</strong><small>Lacak status pesanan</small></span><ArrowRight /></Link><Link to="/wishlist"><span className="menu-icon"><Heart /></span><span><strong>Wishlist</strong><small>Produk yang kamu simpan</small></span><ArrowRight /></Link><Link to="/products"><span className="menu-icon"><Search /></span><span><strong>Jelajahi produk</strong><small>Temukan koleksi ASRI</small></span><ArrowRight /></Link></div><p className="profile-note">ASRI Collection menggunakan guest checkout. Kamu tidak perlu membuat akun untuk berbelanja.</p></div>;
}
