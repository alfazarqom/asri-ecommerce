-- Requirement V1 reliability: guest rate limits, expiry stock release,
-- late-payment stock reacquisition, and reconciliation cases.
-- This migration is validated only by the repository's isolated local CI.

alter table public.orders
  add column if not exists stock_re_reserved_at timestamptz;

create table if not exists public.api_rate_limit_buckets (
  key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$'),
  window_start timestamptz not null,
  request_count integer not null check (request_count > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (key_hash, window_start)
);

create table if not exists public.payment_reconciliation_cases (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  merchant_order_id text not null,
  case_type text not null check (
    case_type in (
      'late_payment_stock_unavailable',
      'stock_restore_failed',
      'provider_state_mismatch',
      'refund_required',
      'manual_review'
    )
  ),
  status text not null default 'open' check (status in ('open', 'resolved')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, case_type, status)
);

create index if not exists payment_reconciliation_cases_open_idx
  on public.payment_reconciliation_cases(created_at)
  where status = 'open';

alter table public.api_rate_limit_buckets enable row level security;
alter table public.payment_reconciliation_cases enable row level security;

revoke all on public.api_rate_limit_buckets,
  public.payment_reconciliation_cases from public, anon, authenticated;
grant all on public.api_rate_limit_buckets,
  public.payment_reconciliation_cases to service_role;

create or replace function public.consume_asri_rate_limit(
  p_key_hash text,
  p_max_requests integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  if p_key_hash is null or p_key_hash !~ '^[a-f0-9]{64}$'
     or p_max_requests < 1 or p_max_requests > 1000
     or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'Invalid rate limit arguments' using errcode = '22023';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds)
      * p_window_seconds
  );

  insert into public.api_rate_limit_buckets (
    key_hash, window_start, request_count
  ) values (p_key_hash, v_window_start, 1)
  on conflict (key_hash, window_start)
  do update set
    request_count = public.api_rate_limit_buckets.request_count + 1,
    updated_at = now()
  returning request_count into v_count;

  delete from public.api_rate_limit_buckets
   where window_start < now() - interval '2 days';

  return v_count <= p_max_requests;
end;
$$;

revoke all on function public.consume_asri_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_asri_rate_limit(text, integer, integer)
  to service_role;

-- Use a 128-bit random suffix for guest order IDs and return a complete
-- idempotent response when the same request key is replayed.
create or replace function public.create_asri_order(
  p_request_key text,
  p_customer_first_name text,
  p_customer_email text,
  p_customer_phone text,
  p_shipping_address jsonb,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_existing public.orders%rowtype;
  v_order_id uuid;
  v_merchant_order_id text;
  v_subtotal bigint := 0;
  v_shipping bigint := 52000;
  v_total bigint;
  v_item jsonb;
  v_product public.products%rowtype;
  v_product_id text;
  v_quantity integer;
  v_unit_price bigint;
  v_item_count integer := 0;
begin
  if p_request_key is null or length(p_request_key) < 16 or length(p_request_key) > 100
     or p_customer_first_name is null or length(trim(p_customer_first_name)) < 2
     or p_customer_email is null or length(trim(p_customer_email)) > 255
     or p_customer_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or p_customer_phone is null or length(trim(p_customer_phone)) < 8
     or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1
     or jsonb_array_length(p_items) > 50 then
    raise exception 'Invalid order input' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_key, 0));

  select * into v_existing
    from public.orders
   where request_key = p_request_key;
  if found then
    return jsonb_build_object(
      'order_id', v_existing.merchant_order_id,
      'status', v_existing.status,
      'payment_status', v_existing.payment_status,
      'subtotal_amount', v_existing.subtotal_amount,
      'shipping_amount', v_existing.shipping_amount,
      'total_amount', v_existing.total_amount,
      'expires_at', v_existing.expires_at,
      'duplicate', true
    );
  end if;

  for v_item in
    select value from jsonb_array_elements(p_items)
    order by value->>'product_id'
  loop
    v_product_id := nullif(trim(v_item->>'product_id'), '');
    v_quantity := nullif(v_item->>'quantity', '')::integer;
    if v_product_id is null or v_quantity is null or v_quantity < 1 or v_quantity > 99 then
      raise exception 'Invalid order item' using errcode = '22023';
    end if;

    select * into v_product
      from public.products
     where id = v_product_id
     for update;

    if not found then
      raise exception 'Product not found: %', v_product_id using errcode = 'P0002';
    end if;

    if lower(coalesce(v_product.availability, '')) not in ('in stock', 'preorder', 'available for order') then
      raise exception 'Product unavailable: %', v_product_id using errcode = '22023';
    end if;

    if v_product.inventory is not null and v_product.inventory < v_quantity then
      raise exception 'Insufficient stock: %', v_product_id using errcode = '22003';
    end if;

    if v_product.sale_price is not null and v_product.sale_price > 0 and v_product.sale_price < v_product.price then
      if v_product.sale_price <> trunc(v_product.sale_price) then
        raise exception 'Product price must be an integer IDR amount' using errcode = '22023';
      end if;
      v_unit_price := v_product.sale_price::bigint;
    else
      if v_product.price <> trunc(v_product.price) then
        raise exception 'Product price must be an integer IDR amount' using errcode = '22023';
      end if;
      v_unit_price := v_product.price::bigint;
    end if;

    v_subtotal := v_subtotal + (v_unit_price * v_quantity);
    v_item_count := v_item_count + 1;
  end loop;

  if v_item_count <> jsonb_array_length(p_items) or v_subtotal <= 0 then
    raise exception 'Invalid order subtotal' using errcode = '22023';
  end if;

  v_total := v_subtotal + v_shipping;
  v_merchant_order_id := 'ASRI-' || upper(encode(gen_random_bytes(16), 'hex'));

  insert into public.orders (
    merchant_order_id, status, payment_status, currency,
    customer_first_name, customer_email, customer_phone,
    billing_address, shipping_address,
    subtotal_amount, shipping_amount, total_amount,
    expires_at, request_key
  ) values (
    v_merchant_order_id, 'pending_payment', 'pending', 'IDR',
    trim(p_customer_first_name), lower(trim(p_customer_email)), trim(p_customer_phone),
    coalesce(p_shipping_address, '{}'::jsonb),
    coalesce(p_shipping_address, '{}'::jsonb),
    v_subtotal, v_shipping, v_total,
    now() + interval '24 hours', p_request_key
  ) returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_product_id := trim(v_item->>'product_id');
    v_quantity := (v_item->>'quantity')::integer;

    select * into v_product
      from public.products
     where id = v_product_id
     for update;

    if v_product.sale_price is not null and v_product.sale_price > 0 and v_product.sale_price < v_product.price then
      v_unit_price := v_product.sale_price::bigint;
    else
      v_unit_price := v_product.price::bigint;
    end if;

    if v_product.inventory is not null then
      update public.products
         set inventory = inventory - v_quantity,
             updated_at = now()
       where id = v_product_id
         and inventory >= v_quantity;
      if not found then
        raise exception 'Stock changed while creating order' using errcode = '40001';
      end if;
    end if;

    insert into public.order_items (
      order_id, product_id_text, sku, product_name, unit_price, quantity
    ) values (
      v_order_id, v_product_id, coalesce(nullif(v_product.mpn, ''), v_product_id),
      v_product.title, v_unit_price, v_quantity
    );
  end loop;

  return jsonb_build_object(
    'order_id', v_merchant_order_id,
    'status', 'pending_payment',
    'payment_status', 'pending',
    'subtotal_amount', v_subtotal,
    'shipping_amount', v_shipping,
    'total_amount', v_total,
    'expires_at', now() + interval '24 hours',
    'duplicate', false
  );
end;
$$;

revoke all on function public.create_asri_order(text, text, text, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_asri_order(text, text, text, text, jsonb, jsonb)
  to service_role;

-- Expire a bounded batch atomically. Stock is restored once per order.
create or replace function public.expire_asri_orders(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
  v_inventory integer;
  v_restore_ok boolean;
  v_expired integer := 0;
  v_review integer := 0;
begin
  if p_limit < 1 or p_limit > 500 then
    raise exception 'Invalid expiry batch size' using errcode = '22023';
  end if;

  for v_order in
    select *
      from public.orders
     where status = 'pending_payment'
       and payment_status in ('pending', 'failed')
       and expires_at <= now()
       and stock_released_at is null
     order by expires_at, id
     for update skip locked
     limit p_limit
  loop
    v_restore_ok := true;

    -- First pass locks and validates every product before restoring any stock.
    for v_item in
      select product_id_text, sum(quantity)::integer as quantity
        from public.order_items
       where order_id = v_order.id
         and product_id_text is not null
       group by product_id_text
       order by product_id_text
    loop
      select inventory into v_inventory
        from public.products
       where id = v_item.product_id_text
       for update;
      if not found then
        v_restore_ok := false;
        exit;
      end if;
    end loop;

    if v_restore_ok then
      for v_item in
        select product_id_text, sum(quantity)::integer as quantity
          from public.order_items
         where order_id = v_order.id
           and product_id_text is not null
         group by product_id_text
         order by product_id_text
      loop
        update public.products
           set inventory = inventory + v_item.quantity,
               updated_at = now()
         where id = v_item.product_id_text
           and inventory is not null;
      end loop;

      update public.orders
         set status = 'cancelled',
             payment_status = 'expired',
             stock_released_at = now(),
             updated_at = now()
       where id = v_order.id
         and stock_released_at is null
         and payment_status in ('pending', 'failed');

      update public.payment_transactions
         set status = 'expired',
             provider_result_code = coalesce(provider_result_code, 'EXPIRED'),
             updated_at = now()
       where order_id = v_order.id
         and status in ('creating', 'pending', 'failed');

      v_expired := v_expired + 1;
    else
      update public.orders
         set status = 'payment_review',
             payment_status = 'review',
             updated_at = now()
       where id = v_order.id;

      insert into public.payment_reconciliation_cases (
        order_id, merchant_order_id, case_type, details
      ) values (
        v_order.id,
        v_order.merchant_order_id,
        'stock_restore_failed',
        jsonb_build_object('reason', 'product_missing_during_expiry_restore')
      )
      on conflict (order_id, case_type, status) do nothing;

      v_review := v_review + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'expired_count', v_expired,
    'review_count', v_review
  );
end;
$$;

revoke all on function public.expire_asri_orders(integer)
  from public, anon, authenticated;
grant execute on function public.expire_asri_orders(integer)
  to service_role;

-- Lock order before payment so callback and expiry use the same lock order.
-- A verified late success attempts to reacquire released stock atomically.
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
  v_order public.orders%rowtype;
  v_payment public.payment_transactions%rowtype;
  v_event_id uuid;
  v_new_status text;
  v_item record;
  v_inventory integer;
  v_stock_available boolean := true;
begin
  if p_event_key is null or length(p_event_key) <> 64
     or p_merchant_code is null or p_merchant_order_id is null
     or p_reference is null or p_amount is null or p_amount <= 0
     or p_result_code is null then
    raise exception 'Invalid callback arguments' using errcode = '22023';
  end if;

  select * into v_order
    from public.orders
   where merchant_order_id = p_merchant_order_id
   for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

  select * into v_payment
    from public.payment_transactions
   where provider = 'duitku'
     and order_id = v_order.id
     and merchant_order_id = p_merchant_order_id
     and provider_reference = p_reference
   for update;
  if not found then
    raise exception 'Payment transaction not found' using errcode = 'P0002';
  end if;

  if v_payment.amount <> p_amount then
    raise exception 'Callback amount mismatch' using errcode = '22003';
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

  if p_result_code = '00' then
    if v_payment.status = 'refunded'
       or v_order.payment_status = 'refunded' then
      v_new_status := 'review';
      insert into public.payment_reconciliation_cases (
        order_id, merchant_order_id, case_type, details
      ) values (
        v_order.id,
        v_order.merchant_order_id,
        'manual_review',
        jsonb_build_object(
          'reason', 'provider_success_callback_received_after_local_refund'
        )
      )
      on conflict (order_id, case_type, status) do nothing;
    elsif exists (
      select 1
        from public.payment_reconciliation_cases
       where order_id = v_order.id
         and case_type = 'stock_restore_failed'
         and status = 'open'
    ) then
      -- A missing product row prevented stock restoration. Do not confirm
      -- fulfillment even if the provider later verifies payment success.
      v_new_status := 'review';
      update public.orders
         set status = 'payment_review',
             payment_status = 'review',
             updated_at = now()
       where id = v_order.id;

      insert into public.payment_reconciliation_cases (
        order_id, merchant_order_id, case_type, details
      ) values (
        v_order.id,
        v_order.merchant_order_id,
        'manual_review',
        jsonb_build_object(
          'reason', 'verified_payment_received_after_stock_restore_failure'
        )
      )
      on conflict (order_id, case_type, status) do nothing;
    elsif v_order.stock_released_at is not null
       and v_order.stock_re_reserved_at is null then
      -- Validate all stock before decrementing any item.
      for v_item in
        select product_id_text, sum(quantity)::integer as quantity
          from public.order_items
         where order_id = v_order.id
           and product_id_text is not null
         group by product_id_text
         order by product_id_text
      loop
        select inventory into v_inventory
          from public.products
         where id = v_item.product_id_text
         for update;

        if not found or (v_inventory is not null and v_inventory < v_item.quantity) then
          v_stock_available := false;
          exit;
        end if;
      end loop;

      if v_stock_available then
        for v_item in
          select product_id_text, sum(quantity)::integer as quantity
            from public.order_items
           where order_id = v_order.id
             and product_id_text is not null
           group by product_id_text
           order by product_id_text
        loop
          update public.products
             set inventory = inventory - v_item.quantity,
                 updated_at = now()
           where id = v_item.product_id_text
             and inventory is not null;
        end loop;

        update public.orders
           set status = 'confirmed',
               payment_status = 'paid',
               stock_re_reserved_at = now(),
               updated_at = now()
         where id = v_order.id;
        v_new_status := 'paid';
      else
        update public.orders
           set status = 'payment_review',
               payment_status = 'review',
               updated_at = now()
         where id = v_order.id;

        insert into public.payment_reconciliation_cases (
          order_id, merchant_order_id, case_type, details
        ) values (
          v_order.id,
          v_order.merchant_order_id,
          'late_payment_stock_unavailable',
          jsonb_build_object(
            'provider_payment_status', 'paid',
            'stock_released_at', v_order.stock_released_at,
            'action_required', 'admin_refund_or_manual_resolution'
          )
        )
        on conflict (order_id, case_type, status) do nothing;
        v_new_status := 'review';
      end if;
    else
      update public.orders
         set status = 'confirmed',
             payment_status = 'paid',
             updated_at = now()
       where id = v_order.id
         and payment_status <> 'refunded';
      v_new_status := 'paid';
    end if;

    update public.payment_transactions
       set status = 'paid',
           provider_result_code = p_result_code,
           paid_at = coalesce(paid_at, now()),
           updated_at = now()
     where id = v_payment.id
       and status <> 'refunded';
  elsif p_result_code = '02' then
    v_new_status := 'failed';
    update public.payment_transactions
       set status = 'failed',
           provider_result_code = p_result_code,
           updated_at = now()
     where id = v_payment.id
       and status in ('creating', 'pending');
    update public.orders
       set payment_status = 'failed',
           updated_at = now()
     where id = v_order.id
       and payment_status = 'pending';
  elsif p_result_code = '01' then
    v_new_status := 'pending';
    update public.payment_transactions
       set status = 'pending',
           provider_result_code = p_result_code,
           updated_at = now()
     where id = v_payment.id
       and status in ('creating', 'pending');
  else
    v_new_status := 'review';
    update public.payment_transactions
       set status = 'review',
           provider_result_code = p_result_code,
           updated_at = now()
     where id = v_payment.id
       and status in ('creating', 'pending');
    update public.orders
       set payment_status = 'review',
           status = case when status = 'cancelled' then status
                        else 'payment_review' end,
           updated_at = now()
     where id = v_order.id
       and payment_status = 'pending';

    insert into public.payment_reconciliation_cases (
      order_id, merchant_order_id, case_type, details
    ) values (
      v_order.id,
      v_order.merchant_order_id,
      'provider_state_mismatch',
      jsonb_build_object('verified_provider_status', p_result_code)
    )
    on conflict (order_id, case_type, status) do nothing;
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

-- Mark a reconciliation case resolved only after an operator has completed
-- the corresponding manual action in the Duitku merchant portal.
create or replace function public.resolve_asri_reconciliation_case(
  p_case_id uuid,
  p_resolution text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_case public.payment_reconciliation_cases%rowtype;
begin
  if p_case_id is null or p_resolution is null
     or p_resolution not in ('refunded', 'resolved') then
    raise exception 'Invalid reconciliation resolution' using errcode = '22023';
  end if;

  select * into v_case
    from public.payment_reconciliation_cases
   where id = p_case_id
     and status = 'open'
   for update;
  if not found then
    raise exception 'Open reconciliation case not found' using errcode = 'P0002';
  end if;

  if p_resolution = 'refunded' then
    update public.payment_transactions
       set status = 'refunded',
           updated_at = now()
     where order_id = v_case.order_id
       and status = 'paid';
    if not found then
      raise exception 'Paid payment transaction not found' using errcode = 'P0002';
    end if;

    update public.orders
       set status = 'cancelled',
           payment_status = 'refunded',
           updated_at = now()
     where id = v_case.order_id;
  end if;

  update public.payment_reconciliation_cases
     set status = 'resolved',
         details = details || jsonb_build_object(
           'resolution', p_resolution,
           'resolved_at', now()
         ),
         updated_at = now()
   where id = p_case_id;

  return jsonb_build_object(
    'ok', true,
    'case_id', p_case_id,
    'resolution', p_resolution
  );
end;
$$;

revoke all on function public.resolve_asri_reconciliation_case(uuid, text)
  from public, anon, authenticated;
grant execute on function public.resolve_asri_reconciliation_case(uuid, text)
  to service_role;
