-- Isolated local integration tests for Requirement V1.
-- Executed only after supabase db reset in CI; the transaction is rolled back.

begin;

do $$
declare
  v_first jsonb;
  v_duplicate jsonb;
  v_order_id text;
  v_order_uuid uuid;
  v_inventory integer;
  v_result jsonb;
  v_allowed boolean;
  v_case_count integer;
begin
  insert into public.products (
    id, title, description, availability, condition, price,
    link, image_link, brand, inventory
  ) values (
    'TEST-RELIABILITY-001',
    'CI Reliability Product',
    'Temporary product for local integration tests',
    'in stock',
    'new',
    10000,
    'https://example.test/product',
    'https://example.test/image.jpg',
    'ASRI CI',
    5
  )
  on conflict (id) do update
    set inventory = excluded.inventory,
        availability = excluded.availability;

  v_first := public.create_asri_order(
    'ci-request-key-00000001',
    'CI Buyer',
    'ci-buyer@example.test',
    '081234567890',
    jsonb_build_object('address', 'Test address'),
    jsonb_build_array(
      jsonb_build_object('product_id', 'TEST-RELIABILITY-001', 'quantity', 1)
    )
  );
  v_order_id := v_first->>'order_id';

  if v_order_id !~ '^ASRI-[A-F0-9]{32}$' then
    raise exception 'Expected high-entropy merchant order ID, got %', v_order_id;
  end if;
  if (v_first->>'total_amount')::bigint <> 62000 then
    raise exception 'Unexpected server-calculated order total';
  end if;

  v_duplicate := public.create_asri_order(
    'ci-request-key-00000001',
    'CI Buyer',
    'ci-buyer@example.test',
    '081234567890',
    jsonb_build_object('address', 'Test address'),
    jsonb_build_array(
      jsonb_build_object('product_id', 'TEST-RELIABILITY-001', 'quantity', 1)
    )
  );
  if v_duplicate->>'order_id' <> v_order_id
     or v_duplicate->>'duplicate' <> 'true'
     or (v_duplicate->>'total_amount')::bigint <> 62000 then
    raise exception 'Order idempotency replay did not return the original order';
  end if;

  select inventory into v_inventory
    from public.products
   where id = 'TEST-RELIABILITY-001';
  if v_inventory <> 4 then
    raise exception 'Stock should be reserved once, expected 4 got %', v_inventory;
  end if;

  select id into v_order_uuid
    from public.orders
   where merchant_order_id = v_order_id;

  insert into public.payment_transactions (
    order_id, merchant_order_id, provider, environment, status,
    amount, currency, provider_reference
  ) values (
    v_order_uuid, v_order_id, 'duitku', 'sandbox', 'pending',
    62000, 'IDR', 'CI-DUITKU-REF-001'
  );

  update public.orders
     set expires_at = now() - interval '1 second'
   where id = v_order_uuid;

  perform public.expire_asri_orders(10);
  select inventory into v_inventory
    from public.products
   where id = 'TEST-RELIABILITY-001';
  if v_inventory <> 5 then
    raise exception 'Expiry should restore stock once, expected 5 got %', v_inventory;
  end if;

  perform public.expire_asri_orders(10);
  select inventory into v_inventory
    from public.products
   where id = 'TEST-RELIABILITY-001';
  if v_inventory <> 5 then
    raise exception 'Repeated expiry changed stock, expected 5 got %', v_inventory;
  end if;

  v_result := public.apply_duitku_callback(
    repeat('b', 64),
    'D-CI',
    62000,
    v_order_id,
    'CI-DUITKU-REF-001',
    '00',
    'VA',
    array[]::text[],
    jsonb_build_object('source', 'ci-test')
  );
  if v_result->>'payment_status' <> 'paid' then
    raise exception 'Late successful payment should be re-reserved and paid';
  end if;

  select inventory into v_inventory
    from public.products
   where id = 'TEST-RELIABILITY-001';
  if v_inventory <> 4 then
    raise exception 'Late payment should reacquire stock once, expected 4 got %', v_inventory;
  end if;

  v_result := public.apply_duitku_callback(
    repeat('b', 64),
    'D-CI',
    62000,
    v_order_id,
    'CI-DUITKU-REF-001',
    '00',
    'VA',
    array[]::text[],
    jsonb_build_object('source', 'ci-replay')
  );
  if v_result->>'duplicate' <> 'true' then
    raise exception 'Repeated callback was not recognized as duplicate';
  end if;

  select inventory into v_inventory
    from public.products
   where id = 'TEST-RELIABILITY-001';
  if v_inventory <> 4 then
    raise exception 'Duplicate callback changed inventory';
  end if;

  update public.products
     set inventory = 10
   where id = 'TEST-RELIABILITY-001';

  v_first := public.create_asri_order(
    'ci-request-key-00000002',
    'CI Buyer',
    'ci-buyer@example.test',
    '081234567890',
    jsonb_build_object('address', 'Test address'),
    jsonb_build_array(
      jsonb_build_object('product_id', 'TEST-RELIABILITY-001', 'quantity', 1)
    )
  );
  v_order_id := v_first->>'order_id';

  select id into v_order_uuid
    from public.orders
   where merchant_order_id = v_order_id;

  insert into public.payment_transactions (
    order_id, merchant_order_id, provider, environment, status,
    amount, currency, provider_reference
  ) values (
    v_order_uuid, v_order_id, 'duitku', 'sandbox', 'pending',
    62000, 'IDR', 'CI-DUITKU-REF-002'
  );

  update public.orders
     set expires_at = now() - interval '1 second'
   where id = v_order_uuid;
  perform public.expire_asri_orders(10);

  update public.products
     set inventory = 0
   where id = 'TEST-RELIABILITY-001';

  v_result := public.apply_duitku_callback(
    repeat('c', 64),
    'D-CI',
    62000,
    v_order_id,
    'CI-DUITKU-REF-002',
    '00',
    'VA',
    array[]::text[],
    jsonb_build_object('source', 'ci-late-stock-conflict')
  );
  if v_result->>'payment_status' <> 'review' then
    raise exception 'Late payment without stock should require manual review';
  end if;

  select count(*) into v_case_count
    from public.payment_reconciliation_cases
   where merchant_order_id = v_order_id
     and case_type = 'late_payment_stock_unavailable'
     and status = 'open';
  if v_case_count <> 1 then
    raise exception 'Expected one open late-payment reconciliation case';
  end if;

  v_allowed := public.consume_asri_rate_limit(repeat('a', 64), 1, 60);
  if v_allowed is not true then
    raise exception 'First rate-limited request should pass';
  end if;
  v_allowed := public.consume_asri_rate_limit(repeat('a', 64), 1, 60);
  if v_allowed is not false then
    raise exception 'Second rate-limited request should be rejected';
  end if;
end;
$$;

rollback;
