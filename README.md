# ASRI Collection — Storefront

Responsive customer-facing ecommerce frontend for ASRI Collection.

## Stack
- React 18 + TypeScript + Vite
- Tailwind CSS + custom design-system styles
- React Router
- Zustand
- lucide-react

## Requirements
- Node.js 20+
- npm 10+

## Setup
```bash
npm install
cp .env.example .env
npm run dev
```

Configure the public catalog endpoint:
```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
VITE_PRODUCTS_FUNCTION=get-asri-products
```

Only public browser-safe values may use the `VITE_` prefix. Never put Supabase service-role credentials, Duitku API keys, or internal invoice secrets in frontend environment variables.

## Catalog integration
The storefront reads the public `get-asri-products` Supabase Edge Function. The current function returns a JSON array of full `asri_products` rows. The frontend normalizes common product field names for display while retaining the original row in memory. Confirm the actual database columns and image URL fields before production use.

## Implemented customer pages
- App shell: Home, Product listing, Search, Wishlist, Orders, Profile
- Standalone: Product Detail, Product Reviews, Product Questions, Related Products, Cart, Checkout, Address, Shipping, Payment, Payment Return, Order Detail, Order Tracking
- Overlays: responsive category filter drawer and toast feedback

## Integration boundaries
- Cart and wishlist are client-side state for the current browser session.
- Checkout UI is present, but order creation is not implemented because the repository does not contain a trusted order-creation endpoint.
- Duitku invoice creation must remain server-to-server. Do not expose `DUITKU_INTERNAL_API_SECRET` or `DUITKU_API_KEY` to the browser.
- Payment return query parameters are never treated as proof of payment success.
- Guest order tracking remains informational until a dedicated, privacy-limited tracking endpoint exists.

## Commands
```bash
npm run typecheck
npm run build
npm run preview
```

## Design baseline
Implementation follows `App.json` and `design_system.json` version 1.4.0 without changing either baseline file.
