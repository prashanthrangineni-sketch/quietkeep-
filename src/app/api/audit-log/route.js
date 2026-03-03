export const dynamic = 'force-dynamic';

import { createClient } from '@supabase/supabase-js';

export async function GET(request) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { searchParams } = new URL(request.url);
  const user_id = searchParams.get('user_id');
  const limit = parseInt(searchParams.get('limit') || '50');

  if (!user_id) return Response.json({ error: 'user_id required' }, { status: 400 });

  const { data, error } = await supabase
    .from('audit_log')
    .select('*')
    .eq('user_id', user_id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ logs: data || [] });
}
