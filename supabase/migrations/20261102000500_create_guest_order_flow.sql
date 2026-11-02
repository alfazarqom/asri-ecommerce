-- Requirement V1: guest order creation with authoritative pricing and atomic stock reservation.
-- Repository migration only. Not executed against any Supabase project.

alter table public.orders
  add column if not exists expires_at timestamptz,
  add column if not exists stock_released_at timestamptz,
  add column if not exists request_key text;

create unique index if not exists orders_request_key_uidx
  on public.orders(request_key)
  where request_key is not null;

alter table public.order_items
  add column if not exists product_id_text text;

alter table public.order_items
  drop constraint if exists order_items_product_or_variant;

alter table public.order_items
  add constraint order_items_product_or_variant
  check (product_id is not null or product_id_text is not null or variant_id is not null or sku is not null);

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

  select * into v_existing from public.orders where request_key = p_request_key;
  if found then
    return jsonb_build_object(
      'order_id', v_existing.merchant_order_id,
      'status', v_existing.status,
      'expires_at', v_existing.expires_at,
      'duplicate', true
    );
  end if;

  -- Lock every referenced product in deterministic order before reserving stock.
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
  v_merchant_order_id := 'ASRI-' || upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 12));

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

    select * into v_product from public.products where id = v_product_id for update;

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
