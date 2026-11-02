# Requirement V1 — Guest Checkout, Duitku POP, and Order Lifecycle

Status: implementation is on the feature branch and remains unmerged. No Supabase project migration, Edge Function deployment, production secret change, or live payment has been performed.

Official documentation checked 2 November 2026:
- Duitku POP: https://docs.duitku.com/pop/id/
- Duitku API / Cek Transaksi / expiry periods: https://docs.duitku.com/api/id/

## End-to-end architecture

1. Guest checkout calls `POST /functions/v1/create-order` with customer details, product IDs, quantities, and a browser-persisted idempotency key.
2. The Edge Function validates input and rate limits the caller. The database RPC reloads product rows from `public.products`, applies the approved sale-price rule, checks availability and stock, calculates integer IDR totals, applies Rp52.000 shipping, creates a 24-hour order, and decrements tracked stock in one transaction.
3. The customer is sent to `/payment?orderId=...`. The page calls `POST /functions/v1/create-payment`.
4. The public payment function checks the order and expiry, rate limits the caller, then invokes the internal `duitku-create-invoice` function using `DUITKU_INTERNAL_API_SECRET`. The browser never receives this secret.
5. The invoice function reloads persisted order/item snapshots, validates totals and expiry, signs the Create Invoice request, persists the provider reference/payment URL, and returns the payment URL to the page.
6. The PaymentPage redirects the customer to the Duitku payment URL. Browser return/JS parameters are display-only and never update payment status.
7. Duitku sends its HTTP callback to `duitku-callback`. The function validates the documented HMAC callback signature, independently checks the transaction with Duitku Cek Transaksi, and sends only the verified status to the database RPC.
8. The callback RPC locks the order before the payment transaction, applies an idempotent state transition, and handles late success by trying to reacquire stock atomically.
9. `expire-orders` invokes the expiry RPC. The RPC locks expired orders, restores stock once, marks the order expired, and records reconciliation cases if stock cannot be restored.
10. `order-tracking` exposes a limited guest view protected by a 128-bit random order ID and per-IP/per-order rate limits.

## Edge Functions

| Function | Gateway JWT | Authentication / purpose |
|---|---:|---|
| `create-order` | Required | Public guest checkout using the Supabase anon JWT; rate limited |
| `create-payment` | Required | Public guest payment initiation; calls the internal invoice function |
| `duitku-create-invoice` | Disabled | Server-to-server only; requires `x-internal-secret` |
| `duitku-callback` | Disabled | Public Duitku callback; verifies HMAC and provider status |
| `order-tracking` | Required | Public guest tracking using anon JWT; rate limited |
| `expire-orders` | Disabled | Internal scheduled worker; requires `x-internal-secret` |
| `get-asri-products` | Disabled | Public catalog read function |

## Required Supabase Edge Function secrets

Configure values in the Supabase Edge Function secret manager. Never commit or paste secret values.

| Secret | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only database access |
| `DUITKU_MERCHANT_CODE` | Duitku Merchant Code |
| `DUITKU_API_KEY` | Duitku Merchant/API key for HMAC |
| `DUITKU_ENVIRONMENT` | Exactly `sandbox` or `production` |
| `DUITKU_CALLBACK_URL` | Public HTTPS URL of `duitku-callback` |
| `DUITKU_RETURN_URL` | Customer return URL |
| `DUITKU_INTERNAL_API_SECRET` | Shared internal secret for invoice and expiry worker endpoints |

Optional:
- `DUITKU_PAYMENT_METHOD`: fixed channel code if the merchant deliberately restricts channels.
- `DUITKU_EXPIRY_PERIOD`: integer minutes passed to Create Invoice. Provider maximum/default expiry varies by payment channel. Confirm the selected channel's limits before setting this value.

The database order expiry is fixed at 24 hours. Duitku's provider-side expiry may vary by channel; the backend does not assume that every payment channel supports the same 24-hour expiry. Any verified late success after local stock release enters the atomic stock-reacquisition flow.

## Create order and stock rules

Migration files:
- `20261102000500_create_guest_order_flow.sql`
- `20261102000600_order_payment_reliability.sql`

The database is authoritative:
- Product rows are read from `public.products`.
- `sale_price` is used only when it is non-null, greater than zero, and lower than `price`; otherwise `price` is used.
- IDR prices must be integer amounts.
- Shipping is fixed at Rp52.000.
- Stock with a non-null `inventory` value is decremented at order creation.
- Order IDs use 128-bit random suffixes.
- Checkout request keys are persisted in session storage and protected by an advisory transaction lock and unique index.
- Duplicate order requests return the existing order rather than decrementing stock again.
- Order expiry is 24 hours after creation.

## Invoice creation

Public caller:
- `POST /functions/v1/create-payment`
- JSON body: `{ "merchant_order_id": "ASRI-..." }`
- Requires the normal Supabase anon JWT at the Edge Function gateway.

Internal invoice endpoint:
- `POST /functions/v1/duitku-create-invoice`
- Header: `x-internal-secret: <DUITKU_INTERNAL_API_SECRET>`
- JSON body: `{ "merchant_order_id": "ASRI-..." }`

Create Invoice follows the current POP documentation:
- POST JSON to the sandbox or production `/api/merchant/createInvoice` endpoint.
- Timestamp is Unix milliseconds.
- `stringToSign = merchantCode + timestamp`.
- `signature = HMAC_SHA256(stringToSign, apiKey)`.
- Send `x-duitku-merchantcode`, `x-duitku-timestamp`, and `x-duitku-signature`.
- Validate HTTP status and provider `statusCode` separately.
- Validate returned payment URL origin against the selected sandbox/production Duitku host.
- Persist provider reference and payment URL before returning them to the browser.
- If the provider may have created an invoice but persistence fails or times out, leave the transaction for reconciliation; do not automatically create a second invoice.

## Callback and transaction verification

Duitku POP callback is HTTP POST `application/x-www-form-urlencoded`. Its HMAC is:
```text
stringToSign = merchantCode + amount + merchantOrderId
signature = HMAC_SHA256(stringToSign, apiKey)
```

The callback signature does not cover `resultCode` or `reference`. The implementation therefore verifies the transaction through the official Cek Transaksi API before applying status:
- Sandbox: `https://sandbox.duitku.com/webapi/api/merchant/transactionStatus`
- Production: `https://passport.duitku.com/webapi/api/merchant/transactionStatus`
- Request signature: `HMAC_SHA256(merchantCode + merchantOrderId, apiKey)`
- Request body follows the official JSON examples, even though the docs' type label says x-www-form-urlencoded.
- The provider response must match merchant order ID, reference, amount, and a known status.

Verified Cek Transaksi status:
- `00`: success.
- `01`: pending/process.
- `02`: failed/expired.

The RPC stores callback events using a unique event key bound to merchant code, amount, merchant order ID, provider reference, and verified status. Duplicate events do not apply inventory changes twice. The order row is locked before the payment row so callback and expiry workers use a consistent lock order.

The POP docs require a successful callback endpoint to return HTTP 200 and describe up to five callback retries. This implementation acknowledges only after provider verification and database commit. Browser redirect/JS callbacks are never proof of payment.

## Expiry, stock restoration, and late payment

`expire-orders`:
- POST endpoint, no gateway JWT.
- Requires `x-internal-secret` matching `DUITKU_INTERNAL_API_SECRET`.
- Calls `expire_asri_orders(100)`.
- Processes a bounded batch with row locks and `SKIP LOCKED`.
- Restores stock from immutable order-item quantities only once using `stock_released_at`.
- Marks pending/failed unpaid orders expired after their 24-hour deadline.
- Creates an open reconciliation case if a product row needed for stock restoration no longer exists.

A verified late success after stock release:
- Locks the order and all referenced products.
- Checks every product's available inventory before decrementing any stock.
- Reacquires stock atomically when all tracked stock is available and confirms the order.
- If stock is unavailable, records the provider payment as paid, puts the order in `payment_review`, and creates an open `late_payment_stock_unavailable` case. It does not silently confirm fulfillment.

The GitHub Actions workflow `.github/workflows/expire-orders.yml` is scheduled every five minutes. After deployment, configure repository secrets:
- `ASRI_EXPIRY_WORKER_URL`: full HTTPS URL to the deployed `expire-orders` function.
- `ASRI_EXPIRY_WORKER_SECRET`: same value as Supabase Edge Function secret `DUITKU_INTERNAL_API_SECRET`.

Until those secrets and the deployed function are configured, the scheduled workflow intentionally skips the request. No schedule has been activated against production in this implementation.

## Guest order tracking and rate limits

`POST /functions/v1/order-tracking` with `{ "merchant_order_id": "ASRI-..." }`.

The endpoint returns only:
- merchant order ID,
- order status and payment status,
- total amount and timestamps,
- product names, quantities, and unit prices.

It does not return customer name, email, phone, or address. The new order ID has a 128-bit random suffix. Rate limits are:
- Create order: 5 requests per IP per minute.
- Create payment: 5 requests per IP per minute.
- Guest tracking: 20 requests per IP per minute and 5 requests per IP/order per minute.

Rate-limit keys are SHA-256 hashes; raw IP addresses are not persisted.

## Refund and reconciliation

There is no automated Duitku refund API call in this implementation. A late payment without stock creates an open reconciliation case. The operator must:
1. Review the case and the verified paid provider transaction.
2. Perform the refund through the merchant's approved Duitku process/dashboard.
3. Only after the provider refund is confirmed, call the service-role-only `resolve_asri_reconciliation_case(case_id, 'refunded')` RPC to mark the payment and order refunded and close the case.

The RPC is not exposed to anon/authenticated clients. A `'resolved'` resolution closes a case without claiming a provider refund occurred. The service-role-only `cancel_asri_unpaid_order(merchant_order_id)` RPC supports admin cancellation of an unpaid order and restores stock once; it refuses paid/terminal orders and opens a review case if stock cannot be restored. Do not mark a case refunded before the external refund is actually complete.

## Verification

CI workflows:
- `.github/workflows/deno-check.yml`: Deno type-check, lint, unit tests, and formatting.
- `.github/workflows/supabase-migration.yml`: clean local Supabase migration reset, Requirement V1 SQL lifecycle tests, and local schema lint.
- `.github/workflows/frontend-ci.yml`: frontend build and Playwright browser smoke tests.
- `.github/workflows/expire-orders.yml`: scheduled expiry worker invocation after deployment secrets are configured.

Local commands:
```sh
deno check supabase/functions/create-order/index.ts
deno check supabase/functions/create-payment/index.ts
deno check supabase/functions/duitku-create-invoice/index.ts
deno check supabase/functions/duitku-callback/index.ts
deno check supabase/functions/order-tracking/index.ts
deno check supabase/functions/expire-orders/index.ts
deno test supabase/functions/
deno lint supabase/functions/
deno fmt --check supabase/functions/
supabase db reset --local
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/requirement-v1.sql
supabase db lint --local
npm run build
npm run test:e2e
```

These tests are intended for isolated local/CI fixtures. No production migration, deployment, secret configuration, or real payment is performed by CI.
