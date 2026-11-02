-- Verify callback payment state through Duitku's documented transactionStatus API.
-- Repository migration only; it is applied only by local CI unless separately approved.

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
     and provider_reference = p_reference
   for update;

  if not found then
    raise exception 'Payment transaction not found' using errcode = 'P0002';
  end if;

  if v_payment.amount <> p_amount then
    raise exception 'Callback amount mismatch' using errcode = '22003';
  end if;

  -- p_result_code is the independently verified transactionStatus statusCode,
  -- not the callback's unsigned resultCode field.
  if p_result_code = '00' then
    v_new_status := 'paid';
    update public.payment_transactions
       set status = 'paid',
           provider_result_code = p_result_code,
           paid_at = coalesce(paid_at, now()),
           updated_at = now()
     where id = v_payment.id
       and status in ('creating', 'pending');

    update public.orders
       set payment_status = 'paid',
           status = case when status = 'pending_payment' then 'confirmed'
                        when status = 'cancelled' then 'payment_review'
                        else status end,
           updated_at = now()
     where id = v_payment.order_id
       and payment_status = 'pending';
  elsif p_result_code = '02' then
    -- Duitku transactionStatus defines 02 as canceled.
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
     where id = v_payment.order_id
       and payment_status = 'pending';
  elsif p_result_code = '01' then
    -- Duitku transactionStatus defines 01 as pending; do not mark it failed.
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
     where id = v_payment.order_id
       and payment_status = 'pending';
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
