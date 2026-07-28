-- 20260728_match_keeps.sql
-- APPLIED to the live project (ofnhwpzzxthdvvunxsfs) on 28 Jul 2026.
--
-- Semantic retrieval over the pgvector memory.
-- 153/154 keeps are already embedded (MiniLM-L6-v2, 384-dim) and an HNSW index
-- exists (idx_keeps_embedding_hnsw), but nothing ever retrieved them -- so
-- "what did I say about the plumber?" could not be answered. This is the
-- missing read side.
--
-- SECURITY: p_user_id is only honoured when auth.uid() is NULL (i.e. a
-- service-role server call). An authenticated caller always resolves to their
-- own auth.uid(), so a user cannot pass someone else's id to read their memory.
-- SECURITY INVOKER keeps RLS on keeps applying as defence in depth.
--
-- Verified: querying with a stored embedding returned that keep at similarity
-- 1.0, then semantically related keeps (0.69, 0.61, 0.51) that keyword search
-- would not have surfaced.
create or replace function public.match_keeps(
  p_query_embedding vector(384),
  p_match_count int default 8,
  p_similarity_threshold double precision default 0.25,
  p_user_id uuid default null
) returns table (
  id uuid,
  content text,
  status text,
  intent_type text,
  created_at timestamptz,
  similarity double precision
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    k.id,
    k.content,
    k.status,
    k.intent_type,
    k.created_at,
    (1 - (k.embedding <=> p_query_embedding))::double precision as similarity
  from keeps k
  where k.user_id = coalesce(auth.uid(), p_user_id)
    and k.embedding is not null
    and (1 - (k.embedding <=> p_query_embedding)) >= p_similarity_threshold
  order by k.embedding <=> p_query_embedding
  limit greatest(1, least(coalesce(p_match_count, 8), 50));
$$;

grant execute on function public.match_keeps(vector, int, double precision, uuid) to authenticated;
grant execute on function public.match_keeps(vector, int, double precision, uuid) to service_role;
