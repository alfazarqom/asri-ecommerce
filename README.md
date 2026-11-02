# ASRI Collection — Storefront

Responsive customer-facing ecommerce storefront for ASRI Collection.

## Stack
- React 18 + TypeScript + Vite
- Tailwind CSS + custom design-system styles
- React Router
- Zustand
- lucide-react
- Supabase Database + Edge Functions
- Duitku POP

## Requirements
- Node.js 20+
- npm 10+
- Deno 2.x for Edge Function checks
- Supabase CLI for local database validation

## Setup
```bash
npm install
cp .env.example .env
npm run dev
```

Configure only public browser-safe values:
```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
VITE_PRODUCTS_FUNCTION=get-asri-products
```

Never put Supabase service-role credentials, Duitku API keys, or internal function secrets in frontend environment variables.

## Catalog integration
The storefront reads the public `get-asri-products` Supabase Edge Function. The function reads from `public.products` and returns product rows. The frontend normalizes the catalog fields including `title`, `price`, `sale_price`, `image_link`, `additional_image_link`, `product_type`, `availability`, and `inventory`.

## Customer pages
- App shell: Home, Product listing, Search, Wishlist, Orders, Profile
- Standalone: Product Detail, Product Reviews, Product Questions, Related Products, Cart, Checkout, Address, Shipping, Payment, Payment Return, Order Detail, Order Tracking
- Overlays: responsive category filter drawer and toast feedback

## Checkout and payment flow
- Guest checkout does not require customer Supabase Auth.
- `create-order` validates checkout input and delegates authoritative pricing, stock checks, fixed Rp52.000 shipping, order snapshots, idempotency, and stock reservation to a server-side database transaction.
- Effective price: use `sale_price` only when it is greater than zero and lower than `price`; otherwise use `price`.
- Orders expire 24 hours after creation.
- `create-payment` invokes the internal `duitku-create-invoice` function. Duitku credentials and internal secrets remain server-side.
- Duitku callback HMAC is checked and transaction status is independently verified with the official Cek Transaksi API.
- A late successful payment attempts atomic stock reacquisition; if stock is unavailable, the order enters manual payment/refund reconciliation.
- Guest tracking returns limited order information and is rate limited.
- The browser return URL and Duitku JS callbacks are never treated as proof of payment success.

See [docs/duitku-pop.md](docs/duitku-pop.md) for the backend contract, required server-side secrets, worker scheduling, reconciliation procedure, and verification steps.

## Commands
```bash
npm run typecheck
npm run build
npm run test:e2e
npm run preview
```

## CI
- Deno type-check, lint, unit tests, and format check.
- Local Supabase migration reset and schema lint.
- SQL lifecycle tests for idempotency, stock reservation/release, late payment, and rate limits.
- Frontend production build and Playwright browser smoke tests.
- Scheduled expiry worker invocation once its deployment URL and secret are configured.

## Deployment boundary
All code changes remain on the feature branch and draft PR until reviewed. Repository CI uses isolated local Supabase instances and mocked browser/provider responses. Production database migrations, Edge Function deployment, secret configuration, and real Duitku payments require separate approval.
