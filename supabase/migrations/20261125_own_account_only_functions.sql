-- 25 November 2026 - Three database functions trusted whatever account id they were given.
-- Found by the reconciler thread's security-advisor run; confirmed on the live database by Thread 3.
--
-- Plain words:
--   register_device_token  let anyone, without signing in, attach their own phone to
--                          another account's notifications (and knock the real phone off).
--   check_geo_triggers     let anyone read another account's location reminders
--                          (text, place name) by passing that account's id.
--   evaluate_keep          let anyone queue reminders on another account's keeps.
--   get_share_by_token     handed the owner's account id to anyone holding a share link,
--                          which is how a stranger would get an id to use above.
--
-- Fix:
--   1. Each of the three now refuses a website caller (signed-in or signed-out) unless the
--      account id is the caller's own. The server key and scheduled jobs are not affected.
--   2. Signed-out visitors can no longer run them at all.
--   3. The share-link lookup no longer gives out the owner's account id.
--
-- How step 1 is done: the same few guard lines are put at the top of each function's
-- existing body, so nothing else in those long functions is retyped or changed.
-- Running this file twice is safe.
--
-- Undo: see the bottom of this file.

do $$
declare
  f record;
  v_def text;
  v_guard text := E'\nBEGIN\n'
    || E'  -- qk_guard_own_user (25 Nov 2026): a website caller may only act on their own account.\n'
    || E'  IF coalesce(auth.role(), '''') IN (''anon'', ''authenticated'')\n'
    || E'     AND (auth.uid() IS NULL OR auth.uid() <> p_user_id) THEN\n'
    || E'    RAISE EXCEPTION ''not allowed'' USING ERRCODE = ''42501'';\n'
    || E'  END IF;\n';
begin
  for f in
    select p.oid, p.proname, p.prosrc
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('register_device_token', 'check_geo_triggers', 'evaluate_keep')
  loop
    if f.prosrc like '%qk_guard_own_user%' then
      continue;
    end if;
    v_def := pg_get_functiondef(f.oid);
    if position(E'\nBEGIN\n' in v_def) = 0 then
      raise exception 'could not find the start of %', f.proname;
    end if;
    -- first BEGIN only: the start of the function body
    v_def := overlay(v_def placing v_guard from position(E'\nBEGIN\n' in v_def) for length(E'\nBEGIN\n'));
    execute v_def;
  end loop;
end $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('register_device_token', 'check_geo_triggers', 'evaluate_keep')
  loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('revoke all on function %s from anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;

-- The share-link lookup keeps its shape (so the page does not break) but the owner's
-- account id is no longer filled in.
create or replace function public.get_share_by_token(p_token text)
returns table (id uuid, user_id uuid, share_type text, resource_id uuid, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  -- Returns one share link, and only to a caller who already knows its exact code.
  -- 25 Nov 2026: user_id is always empty; a share link must not reveal whose account it is.
  if p_token is null or length(p_token) < 8 then
    return;
  end if;
  return query
    update public.share_tokens s
       set view_count = coalesce(s.view_count, 0) + 1
     where s.token = p_token and s.is_active = true
    returning s.id, null::uuid, s.share_type, s.resource_id, s.expires_at;
end $$;
revoke all on function public.get_share_by_token(text) from public;
grant execute on function public.get_share_by_token(text) to anon, authenticated;

-- Minor, from the same advisor run: pin where this helper looks things up.
alter function public.normalise_phone_e164(text) set search_path = '';

-- Undo -------------------------------------------------------------------------
-- The guard is six lines at the top of each of the three functions, between
-- "BEGIN" and the first original line; remove them with create or replace.
-- grant execute on function public.register_device_token(uuid, text, text, text, text, text, text) to anon;
-- grant execute on function public.check_geo_triggers(uuid, double precision, double precision, double precision, double precision, double precision) to anon;
-- grant execute on function public.evaluate_keep(uuid, uuid, text, text) to anon;
-- get_share_by_token: change "null::uuid" back to "s.user_id".
-- alter function public.normalise_phone_e164(text) reset search_path;
