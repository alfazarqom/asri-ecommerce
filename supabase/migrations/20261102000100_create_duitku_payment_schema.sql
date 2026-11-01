-- Duitku POP baseline schema.
-- This migration is repository code only; it has NOT been executed against Supabase.

create extension if not exists pgcrypto;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  merchant_order_id text not null unique,
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'confirmed', 'cancelled', 'payment_review')),
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'paid', 'failed', 'expired', 'refunded', 'review')),
  currency char(3) not null default 'IDR' check (currency = 'IDR'),
  customer_first_name text,
  customer_last_name text,
  customer_email text,
  customer_phone text,
  billing_address jsonb not null default '{}'::jsonb,
  shipping_address jsonb not null default '{}'::jsonb,
  subtotal_amount bigint not null check (subtotal_amount >= 0),
  shipping_amount bigint not null default 0 check (shipping_amount >= 0),
  total_amount bigint not null check (total_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_total_matches_components
    check (total_amount = subtotal_amount + shipping_amount)
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  product_id uuid,
  variant_id uuid,
  sku text,
  product_name text not null,
  unit_price bigint not null check (unit_price >= 0),
  quantity integer not null check (quantity > 0),
  line_total bigint generated always as (unit_price * quantity) stored,
  created_at timestamptz not null default now(),
  constraint order_items_product_or_variant
    check (product_id is not null or variant_id is not null or sku is not null)
);

create index if not exists order_items_order_id_idx
  on public.order_items(order_id);

create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  merchant_order_id text not null unique references public.orders(merchant_order_id) on update cascade on delete restrict,
  provider text not null default 'duitku' check (provider = 'duitku'),
  environment text not null check (environment in ('sandbox', 'production')),
  status text not null default 'creating'
    check (status in ('creating', 'pending', 'paid', 'failed', 'expired', 'refunded', 'review')),
  amount bigint not null check (amount > 0),
  currency char(3) not null default 'IDR' check (currency = 'IDR'),
  provider_reference text unique,
  payment_url text,
  payment_method text,
  provider_result_code text,
  provider_result_message text,
  request_snapshot jsonb not null default '{}'::jsonb,
  response_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists payment_transactions_status_idx
  on public.payment_transactions(status, created_at desc);

create table if not exists public.payment_callback_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  provider text not null default 'duitku' check (provider = 'duitku'),
  merchant_order_id text not null,
  provider_reference text,
  amount bigint not null,
  result_code text not null,
  payment_code text,
  signature_valid boolean not null default false,
  processing_status text not null default 'processing'
    check (processing_status in ('processing', 'processed', 'duplicate', 'rejected')),
  safe_payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists payment_callback_events_order_idx
  on public.payment_callback_events(merchant_order_id, received_at desc);

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payment_transactions enable row level security;
alter table public.payment_callback_events enable row level security;

revoke all on public.orders, public.order_items, public.payment_transactions,
  public.payment_callback_events from public, anon, authenticated;
grant all on public.orders, public.order_items, public.payment_transactions,
  public.payment_callback_events to service_role;

-- Apply a verified Duitku callback atomically and idempotently.
create or replace function public.apply_duitku_callback(
  p_event_key text,
  p_merchant_code text,
  p_amount bigint,
  p_merchant_order_id text,
  p_reference text,
  p_result_code text,
  p_payment_code text,
  p_credit_card_payment_methods text[],
  p_safe_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_payment public.payment_transactions%rowtype;
  v_event_id uuid;
  v_new_status text;
begin
  if p_event_key is null or length(p_event_key) <> 64
     or p_merchant_order_id is null or p_reference is null
     or p_amount is null or p_amount <= 0 or p_result_code is null then
    raise exception 'Invalid callback arguments' using errcode = '22023';
  end if;

  insert into public.payment_callback_events (
    event_key, merchant_order_id, provider_reference, amount,
    result_code, payment_code, signature_valid, safe_payload
  ) values (
    p_event_key, p_merchant_order_id, p_reference, p_amount,
    p_result_code, p_payment_code, true, coalesce(p_safe_payload, '{}'::jsonb)
  )
  on conflict (event_key) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  select *
    into v_payment
    from public.payment_transactions
   where provider = 'duitku'
     and merchant_order_id = p_merchant_order_id
     and (provider_reference = p_reference or provider_reference is null)
   for update;

  if not found then
    raise exception 'Payment transaction not found' using errcode = 'P0002';
  end if;

  if v_payment.amount <> p_amount then
    raise exception 'Callback amount mismatch' using errcode = '22003';
  end if;

  if p_result_code = '00' then
    v_new_status := 'paid';
    update public.payment_transactions
       set status = 'paid',
           provider_reference = coalesce(provider_reference, p_reference),
           provider_result_code = p_result_code,
           paid_at = coalesce(paid_at, now()),
           updated_at = now()
     where id = v_payment.id
       and status <> 'paid';

    update public.orders
       set payment_status = 'paid',
           status = case when status = 'pending_payment' then 'confirmed'\n                        when status = 'cancelled' then 'payment_review'\n                        else status end,
           updated_at = now()
     where id = v_payment.order_id
       and payment_status <> 'paid';
  elsif p_result_code = '01'
        and v_payment.payment_method is not null
        and v_payment.payment_method = any(coalesce(p_credit_card_payment_methods, array[]::text[])) then
    v_new_status := 'failed';
    update public.payment_transactions
       set status = 'failed', provider_result_code = p_result_code, updated_at = now()
     where id = v_payment.id and status in ('creating', 'pending');
    update public.orders
       set payment_status = 'failed', updated_at = now()
     where id = v_payment.order_id and payment_status = 'pending';
  else
    v_new_status := 'review';
    update public.payment_transactions
       set status = 'review', provider_result_code = p_result_code, updated_at = now()
     where id = v_payment.id and status in ('creating', 'pending');
    update public.orders
       set payment_status = 'review',
           status = case when status = 'cancelled' then status else 'payment_review' end,
           updated_at = now()
     where id = v_payment.order_id and payment_status = 'pending';
  end if;

  update public.payment_callback_events
     set processing_status = 'processed',
         processed_at = now()
   where id = v_event_id;

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'payment_status', v_new_status
  );
end;
$$;

revoke all on function public.apply_duitku_callback(
  text, text, bigint, text, text, text, text, text[], jsonb
) from public, anon, authenticated;
grant execute on function public.apply_duitku_callback(
  text, text, bigint, text, text, text, text, text[], jsonb
) to service_role;
