import { useEffect, useState, type FormEvent } from "react";
import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, ChevronRight, CircleHelp, MapPin, Minus, Package, Plus, ShieldCheck, ShoppingBag, Truck, Wallet } from "lucide-react";
import { useStore } from "../store/useStore";
import { formatRupiah } from "../lib/format";
import { ProductCard } from "../components/ProductCard";
import { EmptyState } from "../components/States";
import { Modal } from "../components/Overlays";
import { createOrder, createPayment, trackOrder } from "../lib/checkout";

function PageIntro({ eyebrow, title, description }: { eyebrow?: string; title: string; description?: string }) {
  return <div className="standalone-intro">{eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}<h1>{title}</h1>{description ? <p>{description}</p> : null}</div>;
}
export function ProductDetailPage() {
  const { productId = "" } = useParams();
  const product = useStore(s => s.products.find(p => p.id === productId));
  const addToCart = useStore(s => s.addToCart);
  const notify = useStore(s => s.notify);
  const [quantity, setQuantity] = useState(1);
  const [imageIndex, setImageIndex] = useState(0);
  const [imageViewerOpen, setImageViewerOpen] = useState(false);
  const navigate = useNavigate();
  if (!product) return <div className="page-container"><EmptyState title="Produk tidak ditemukan" description="Produk mungkin sudah tidak tersedia di katalog." action="Kembali ke produk" /></div>;
  const image = product.images[imageIndex] || product.image;
  const canPurchase = product.availability && product.stock !== 0;
  return <div className="page-container detail-page"><div className="breadcrumbs"><Link to="/">Beranda</Link><ChevronRight size={13} /><Link to="/products">Produk</Link><ChevronRight size={13} /><span>{product.name}</span></div><div className="detail-layout"><div className="detail-gallery"><button className="detail-main-image" onClick={() => image && setImageViewerOpen(true)} aria-label="Perbesar foto produk">{image ? <img src={image} alt={product.name} /> : <div className="image-placeholder"><ShoppingBag size={36} /></div>}{product.discountPercentage ? <span className="discount-badge">-{Math.round(product.discountPercentage)}%</span> : null}</button>{product.images.length > 1 ? <div className="thumbnail-row">{product.images.map((src, i) => <button key={src} className={imageIndex === i ? "thumbnail active" : "thumbnail"} onClick={() => setImageIndex(i)}><img src={src} alt={`Foto ${i + 1} ${product.name}`} /></button>)}</div> : null}</div><div className="detail-info"><span className="eyebrow">{product.category}</span><h1>{product.name}</h1><div className="detail-price"><strong>{formatRupiah(product.price)}</strong>{product.originalPrice ? <del>{formatRupiah(product.originalPrice)}</del> : null}</div><p className="detail-description">{product.description || "Pilihan ASRI Collection untuk melengkapi gaya sehari-harimu."}</p><div className="detail-stock"><span className={canPurchase ? "stock-dot" : "stock-dot out"} />{product.availabilityLabel}{product.stock !== null ? ` · Stok ${product.stock}` : ""}</div><div className="quantity-row"><span>Jumlah</span><div className="quantity-control"><button onClick={() => setQuantity(v => Math.max(1, v - 1))} disabled={quantity <= 1} aria-label="Kurangi jumlah"><Minus size={16} /></button><strong>{quantity}</strong><button onClick={() => setQuantity(v => product.stock === null ? v + 1 : Math.min(product.stock, v + 1))} disabled={product.stock !== null && quantity >= product.stock} aria-label="Tambah jumlah"><Plus size={16} /></button></div></div><div className="detail-actions"><button className="button button-primary" disabled={!canPurchase} onClick={() => { addToCart(product, quantity); notify("Produk ditambahkan ke keranjang"); }}><ShoppingBag size={17} /> Tambah ke keranjang</button><button className="button button-secondary" onClick={() => navigate("/cart")}>Lihat keranjang</button></div><div className="detail-trust"><div><Truck /><span>Pengiriman ke seluruh Indonesia</span></div><div><ShieldCheck /><span>Pembayaran diproses dengan aman</span></div></div><div className="detail-links"><Link to={`/product/${product.id}/reviews`}>Ulasan produk <ChevronRight /></Link><Link to={`/product/${product.id}/questions`}>Pertanyaan produk <ChevronRight /></Link><Link to={`/product/${product.id}/related`}>Produk terkait <ChevronRight /></Link></div></div></div>{imageViewerOpen && image ? <Modal title={product.name} onClose={() => setImageViewerOpen(false)} className="image-viewer-modal"><img src={image} alt={product.name} /></Modal> : null}</div>;
}

export function ProductReviewsPage() { const { productId = "" } = useParams(); const p = useStore(s => s.products.find(x => x.id === productId)); return <div className="page-container"><PageIntro eyebrow="CUSTOMER VOICES" title="Ulasan produk" description={p?.name} /><EmptyState title="Belum ada ulasan" description="Ulasan pelanggan akan tampil setelah fitur ulasan terhubung." action="Kembali ke produk" to={p ? `/product/${p.id}` : "/products"} /></div>; }
export function ProductQuestionsPage() { const { productId = "" } = useParams(); const p = useStore(s => s.products.find(x => x.id === productId)); return <div className="page-container"><PageIntro eyebrow="NEED TO KNOW" title="Pertanyaan produk" description={p?.name} /><EmptyState title="Belum ada pertanyaan" description="Kamu dapat menghubungi layanan pelanggan untuk informasi produk." action="Kembali ke produk" to={p ? `/product/${p.id}` : "/products"} icon="package" /></div>; }
export function RelatedProductsPage() { const { productId = "" } = useParams(); const products = useStore(s => s.products); const current = products.find(p => p.id === productId); const related = products.filter(p => p.id !== productId && (!current?.category || p.category === current.category)); return <div className="page-container"><PageIntro eyebrow="YOU MAY ALSO LIKE" title="Produk terkait" description={current?.name} />{related.length ? <div className="product-grid">{related.map(p => <ProductCard key={p.id} product={p} />)}</div> : <EmptyState title="Belum ada rekomendasi" description="Produk terkait akan muncul saat katalog tersedia." action="Lihat semua produk" />}</div>; }

export function CartPage() {
  const cart = useStore(s => s.cart); const update = useStore(s => s.updateQuantity); const remove = useStore(s => s.removeFromCart);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const subtotal = cart.reduce((sum, line) => sum + line.product.price * line.quantity, 0);
  if (!cart.length) return <div className="page-container"><EmptyState title="Keranjangmu masih kosong" description="Yuk, temukan produk yang cocok untukmu." action="Mulai belanja" /></div>;
  return <div className="page-container cart-page"><PageIntro eyebrow="YOUR SELECTION" title="Keranjang" description={`${cart.reduce((n,l)=>n+l.quantity,0)} item dipilih`} /><div className="cart-layout"><div className="cart-list">{cart.map(({ product, quantity }) => <article className="cart-item" key={product.id}><Link to={`/product/${product.id}`} className="cart-image">{product.image ? <img src={product.image} alt={product.name} /> : <ShoppingBag />}</Link><div className="cart-item-info"><Link to={`/product/${product.id}`} className="cart-item-name">{product.name}</Link><span>{formatRupiah(product.price)}</span><div className="quantity-control"><button onClick={() => update(product.id, quantity - 1)} aria-label="Kurangi jumlah"><Minus size={14} /></button><strong>{quantity}</strong><button onClick={() => update(product.id, quantity + 1)} disabled={product.stock !== null && quantity >= product.stock} aria-label="Tambah jumlah"><Plus size={14} /></button></div></div><div className="cart-item-end"><strong>{formatRupiah(product.price * quantity)}</strong><button className="remove-link" onClick={() => setPendingRemove(product.id)} aria-label={`Hapus ${product.name}`}>Hapus</button></div></article>)}</div><aside className="summary-card"><h2>Ringkasan belanja</h2><div><span>Subtotal</span><strong>{formatRupiah(subtotal)}</strong></div><div><span>Pengiriman</span><span className="muted">Dihitung saat checkout</span></div><div className="summary-total"><span>Total sementara</span><strong>{formatRupiah(subtotal)}</strong></div><Link to="/checkout" className="button button-primary button-full">Lanjut checkout <ArrowRight size={16} /></Link><p className="summary-note"><ShieldCheck size={14} /> Checkout tamu, tanpa perlu membuat akun.</p></aside></div>{pendingRemove ? <Modal title="Hapus produk?" onClose={() => setPendingRemove(null)} className="confirmation-modal"><p>Produk ini akan dihapus dari keranjang.</p><div className="modal-actions"><button className="button button-secondary" onClick={() => setPendingRemove(null)}>Batal</button><button className="button button-primary" onClick={() => { remove(pendingRemove); setPendingRemove(null); }}>Hapus produk</button></div></Modal> : null}</div>;
}

export function CheckoutPage() {
  const cart = useStore(s => s.cart);
  const subtotal = cart.reduce((sum, line) => sum + line.product.price * line.quantity, 0);
  const clearCart = useStore(s => s.clearCart);
  const notify = useStore(s => s.notify);
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());

  if (!cart.length) return <div className="page-container"><EmptyState title="Keranjang kosong" description="Tambahkan produk sebelum checkout." action="Lihat produk" /></div>;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const order = await createOrder({ name, email, phone, address }, cart, requestKey);
      clearCart();
      notify("Pesanan berhasil dibuat. Lanjutkan ke pembayaran.", "success");
      navigate(`/payment?orderId=${encodeURIComponent(order.order_id)}`);
      setRequestKey(crypto.randomUUID());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pesanan belum dapat dibuat.");
    } finally {
      setSubmitting(false);
    }
  };

  return <div className="page-container checkout-page"><PageIntro eyebrow="SECURE CHECKOUT" title="Informasi pengiriman" description="Isi detail penerima untuk melanjutkan." /><form className="checkout-form" onSubmit={submit}><div className="form-section"><h2>Kontak penerima</h2><label>Nama lengkap<input required minLength={2} maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="Nama penerima" /></label><div className="form-grid"><label>Email<input type="email" required maxLength={255} value={email} onChange={e => setEmail(e.target.value)} placeholder="nama@email.com" /></label><label>Nomor WhatsApp<input required minLength={8} maxLength={30} value={phone} onChange={e => setPhone(e.target.value)} placeholder="08xxxxxxxxxx" /></label></div></div><div className="form-section"><h2><MapPin size={18} /> Alamat pengiriman</h2><label>Alamat lengkap<textarea required minLength={8} maxLength={1000} rows={3} value={address} onChange={e => setAddress(e.target.value)} placeholder="Jalan, nomor rumah, RT/RW, kelurahan…" /></label><p className="form-hint">Ongkos kirim tetap Rp52.000 ke seluruh Indonesia.</p></div><div className="checkout-total"><span>Subtotal sementara (dihitung ulang server)</span><strong>{formatRupiah(subtotal)}</strong></div>{error ? <div className="integration-notice" role="alert"><CircleHelp size={18} /><p>{error}</p></div> : null}<button className="button button-primary button-full" type="submit" disabled={submitting}>{submitting ? "Membuat pesanan…" : "Buat pesanan"} <ArrowRight size={16} /></button></form></div>;
}
export function AddressPage() { return <div className="page-container"><PageIntro title="Alamat pengiriman" description="Kelola alamat untuk pesananmu." /><EmptyState title="Belum ada alamat tersimpan" description="Alamat dapat diisi saat checkout tamu." action="Kembali ke checkout" to="/checkout" icon="package" /></div>; }
export function ShippingPage() { return <div className="page-container"><PageIntro title="Pengiriman" description="Pilihan pengiriman pesanan." /><div className="integration-notice"><Truck size={20} /><p>Ongkos kirim tetap Rp52.000 untuk seluruh Indonesia.</p></div><Link className="button button-primary" to="/checkout">Kembali ke checkout</Link></div>; }
export function PaymentPage() {
  const [params] = useSearchParams();
  const orderId = params.get("orderId") || "";
  const [paymentUrl, setPaymentUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (!orderId) {
      setError("Nomor pesanan tidak ditemukan.");
      setLoading(false);
      return;
    }
    createPayment(orderId)
      .then((payment) => {
        if (active) setPaymentUrl(payment.payment_url);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Invoice belum dapat dibuat.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [orderId]);
  return <div className="page-container">
    <PageIntro title="Pembayaran" description="Invoice dibuat melalui server Asri dan Duitku. Status pembayaran final tetap menunggu callback resmi." />
    <div className="tracking-reference"><span>Nomor pesanan</span><strong>{orderId || "Belum tersedia"}</strong></div>
    <div className="payment-method-card">
      <span className="payment-icon"><Wallet /></span>
      <div><strong>Duitku POP</strong><p>{loading ? "Menyiapkan invoice…" : paymentUrl ? "Invoice siap. Lanjutkan pembayaran di halaman Duitku." : "Invoice belum tersedia."}</p></div>
      <span className="status-pill pending">Menunggu</span>
    </div>
    {error ? <div className="integration-notice" role="alert"><CircleHelp size={18} /><p>{error}</p></div> : null}
    {paymentUrl ? <a className="button button-primary button-full" href={paymentUrl} target="_blank" rel="noopener noreferrer">Lanjutkan ke Duitku <ArrowRight size={16} /></a> : null}
    <Link className="button button-secondary" to={`/order-tracking/${encodeURIComponent(orderId)}`}>Lacak pesanan</Link>
  </div>;
}
export function PaymentReturnPage() { const [params] = useSearchParams(); const orderId = params.get("merchantOrderId") || params.get("orderId"); return <div className="page-container payment-return"><span className="success-illustration"><ShieldCheck size={32} /></span><PageIntro eyebrow="PAYMENT RETURN" title="Pembayaran sedang diverifikasi" description="Status dari halaman kembali tidak dianggap sebagai bukti pembayaran berhasil. Status final harus dikonfirmasi backend melalui callback Duitku." /><div className="tracking-reference"><span>Nomor pesanan</span><strong>{orderId || "Belum tersedia"}</strong></div><Link className="button button-primary button-full" to="/orders">Lihat pesanan</Link><Link className="text-link center-link" to="/">Kembali ke beranda</Link></div>; }
export function OrderDetailPage() {
  const { orderId = "" } = useParams();
  const [result, setResult] = useState<Awaited<ReturnType<typeof trackOrder>> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (!orderId) return;
    trackOrder(orderId)
      .then((data) => { if (active) setResult(data); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Detail pesanan belum tersedia."); });
    return () => { active = false; };
  }, [orderId]);
  return <div className="page-container">
    <PageIntro title="Detail pesanan" description="Ringkasan status pesanan dari server Asri." />
    <div className="tracking-reference"><span>Nomor pesanan</span><strong>{orderId}</strong></div>
    {error ? <div className="integration-notice" role="alert"><Package size={20} /><p>{error}</p></div> : null}
    {result ? <div className="order-lookup-card">
      <p>Status pesanan: <strong>{result.order.status}</strong></p>
      <p>Status pembayaran: <strong>{result.order.payment_status}</strong></p>
      <p>Total: <strong>{formatRupiah(result.order.total_amount)}</strong></p>
      <h2>Item pesanan</h2>
      {result.items.map((item, index) => <div className="checkout-total" key={`${item.product_name}-${index}`}><span>{item.product_name} × {item.quantity}</span><strong>{formatRupiah(item.unit_price * item.quantity)}</strong></div>)}
    </div> : null}
    <Link className="button button-primary" to={`/order-tracking/${encodeURIComponent(orderId)}`}>Lacak pesanan</Link>
  </div>;
}
export function OrderTrackingPage() {
  const { orderId = "" } = useParams();
  const navigate = useNavigate();
  const [value, setValue] = useState(orderId);
  const [result, setResult] = useState<Awaited<ReturnType<typeof trackOrder>> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setValue(orderId);
    setResult(null);
    setError("");
    if (!orderId) return;
    let active = true;
    setLoading(true);
    trackOrder(orderId)
      .then((data) => { if (active) setResult(data); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Status pesanan belum dapat dimuat."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [orderId]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = value.trim();
    if (normalized) navigate(`/order-tracking/${encodeURIComponent(normalized)}`);
  };
  return <div className="page-container">
    <PageIntro eyebrow="ORDER STATUS" title="Lacak pesanan" description="Pantau status pesanan ASRI menggunakan nomor pesanan." />
    <form className="order-lookup-card" onSubmit={submit}>
      <label htmlFor="tracking-id">Nomor pesanan</label>
      <input id="tracking-id" required value={value} onChange={(event) => setValue(event.target.value)} placeholder="Masukkan nomor pesanan" />
      <button className="button button-primary button-full" type="submit" disabled={loading}>Periksa status <ArrowRight size={16} /></button>
    </form>
    {loading ? <div className="integration-notice"><Package size={20} /><p>Memuat status pesanan…</p></div> : null}
    {error ? <div className="integration-notice" role="alert"><Package size={20} /><p>{error}</p></div> : null}
    {result ? <div className="order-lookup-card">
      <div className="tracking-reference"><span>Nomor pesanan</span><strong>{result.order.merchant_order_id}</strong></div>
      <p>Status pesanan: <strong>{result.order.status}</strong></p>
      <p>Status pembayaran: <strong>{result.order.payment_status}</strong></p>
      <p>Total pembayaran: <strong>{formatRupiah(result.order.total_amount)}</strong></p>
      <h2>Rincian item</h2>
      {result.items.map((item, index) => <div className="checkout-total" key={`${item.product_name}-${index}`}><span>{item.product_name} × {item.quantity}</span><strong>{formatRupiah(item.unit_price * item.quantity)}</strong></div>)}
    </div> : null}
  </div>;
}
