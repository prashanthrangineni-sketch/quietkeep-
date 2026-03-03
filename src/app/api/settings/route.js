export const dynamic = 'force-dynamic';

import { createClient } from '@supabase/supabase-js';

export async function GET(request) {
  // supabase created inside function - NOT at module level
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { data } = await supabase.from('user_settings').select('*').eq('user_id', user.id).maybeSingle();
  return Response.json({ settings: data?.settings || {}, voice_language: data?.voice_language || 'en-IN' });
}

export async function POST(request) {
  // supabase created inside function - NOT at module level
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json();
  await supabase.from('user_settings').upsert(
    { user_id: user.id, settings: body.settings || {}, voice_language: body.voice_language || 'en-IN' },
    { onConflict: 'user_id' }
  );
  return Response.json({ success: true });
}
