-- Privacy item 3.7 (15 Nov 2026), step 2 of 2. Applied to the live database on
-- 15 Nov 2026 under founder-approved request d5500cec, after pull request #236
-- (share page uses get_share_by_token) was merged.
--
-- Removes the rule that let anyone, signed in or not, read every share link.
-- What remains is share_tokens_owner_write: an account sees and changes only
-- its own links. Visitors reach a single link through get_share_by_token
-- (20261115_share_link_lookup.sql), which needs the link's exact code.
--
-- Checked after applying: a signed-out visitor sees 0 rows in share_tokens; a
-- second signed-in account sees 0 of other accounts' rows.
drop policy if exists share_tokens_select on public.share_tokens;

-- Undo (re-opens the gap; do not use without a reason):
-- create policy share_tokens_select on public.share_tokens for select using (true);
