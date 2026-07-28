-- 20260728_apply_business_payment.sql
-- APPLIED to the live project (ofnhwpzzxthdvvunxsfs) on 28 Jul 2026.
--
-- Closes the business payment -> ledger -> khata loop atomically.
--
-- Prior behaviour: the webhook inserted a `note` column that does NOT exist on
-- business_ledger, so PostgREST rejected the insert and a try/catch swallowed
-- the error -- the ledger entry was silently never written, and the customer's
-- khata was never updated at all.
--
-- Doing this in one SQL function makes the three writes atomic and idempotent:
-- the payment row is locked FOR UPDATE, so concurrent webhook deliveries
-- serialise and only the first one posts.
--
-- Verified end-to-end in a self-rolling-back transaction: first call posted one
-- ledger row, a second call returned already_paid with still exactly one row,
-- outstanding_balance went 500 -> 300, total_business 200.
create or replace function public.apply_business_payment(
  p_payment_id uuid,
  p_provider_payment_id text default null,
  p_upi_ref text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay business_payments%rowtype;
  v_ledger_id uuid;
begin
  select * into v_pay from business_payments where id = p_payment_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown_payment');
  end if;

  -- Idempotency: a redelivered webhook must not double-post.
  if v_pay.status = 'paid' then
    return jsonb_build_object('ok', true, 'already_paid', true, 'payment_id', p_payment_id);
  end if;

  update business_payments
     set status              = 'paid',
         provider_payment_id = coalesce(p_provider_payment_id, provider_payment_id),
         upi_ref             = coalesce(p_upi_ref, upi_ref),
         paid_at             = now()
   where id = p_payment_id;

  -- Ledger credit. Matches existing conventions (credit/sales/upi/paid) so the
  -- entry groups correctly in reports; source='qr_payment' marks it auto-posted.
  insert into business_ledger (
    workspace_id, entry_type, category, party_name, amount,
    description, payment_method, payment_status, amount_pending,
    transaction_date, source, created_by
  ) values (
    v_pay.workspace_id, 'credit', 'sales', v_pay.customer_name, v_pay.amount,
    'UPI payment received' || case when p_upi_ref is not null then ' (ref ' || p_upi_ref || ')' else '' end,
    'upi', 'paid', 0,
    current_date, 'qr_payment', v_pay.created_by
  ) returning id into v_ledger_id;

  -- Khata: clear the customer's dues by the amount received.
  if v_pay.customer_id is not null then
    update business_customers
       set outstanding_balance = greatest(0, coalesce(outstanding_balance, 0) - v_pay.amount),
           total_business      = coalesce(total_business, 0) + v_pay.amount,
           last_transaction_date = current_date
     where id = v_pay.customer_id
       and workspace_id = v_pay.workspace_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'payment_id', p_payment_id,
    'ledger_id', v_ledger_id,
    'workspace_id', v_pay.workspace_id,
    'amount', v_pay.amount,
    'customer_id', v_pay.customer_id,
    'party', v_pay.customer_name
  );
end;
$$;

-- Only the server (service role) may post payments.
revoke all on function public.apply_business_payment(uuid, text, text) from public;
revoke all on function public.apply_business_payment(uuid, text, text) from anon;
revoke all on function public.apply_business_payment(uuid, text, text) from authenticated;
grant execute on function public.apply_business_payment(uuid, text, text) to service_role;
