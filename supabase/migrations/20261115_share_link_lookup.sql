-- Privacy item 3.7 (15 Nov 2026), step 1 of 2. Applied to the live database on
-- 15 Nov 2026 under founder-approved request bf318de3.
--
-- share_tokens could be listed by anyone, signed in or not (rule
-- share_tokens_select: using true). This adds a lookup that returns one share
-- link only to a caller who already knows its exact code, and counts the view.
-- Step 2 (20261115_share_tokens_owner_only.sql) removes the open rule once the
-- share page uses this lookup.
create or replace function public.get_share_by_token(p_token text)
returns table (id uuid, user_id uuid, share_type text, resource_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_token is null or length(p_token) < 8 then
    return;
  end if;
  return query
    update public.share_tokens s
       set view_count = coalesce(s.view_count, 0) + 1
     where s.token = p_token and s.is_active = true
    returning s.id, s.user_id, s.share_type, s.resource_id, s.expires_at;
end;
$$;
revoke all on function public.get_share_by_token(text) from public;
grant execute on function public.get_share_by_token(text) to anon, authenticated;

-- Undo: drop function public.get_share_by_token(text);
