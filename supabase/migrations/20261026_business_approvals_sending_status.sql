-- 20261026_business_approvals_sending_status.sql
-- Allow 'sending' state in business_approvals_status_check constraint
-- Required for atomic claim-then-send concurrency pattern in approvals and meta-webhook.

alter table public.business_approvals drop constraint if exists business_approvals_status_check;
alter table public.business_approvals add constraint business_approvals_status_check check (status in ('pending','sending','approved','rejected','expired','executed'));
