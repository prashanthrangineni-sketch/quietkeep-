export const dynamic = 'force-dynamic'

import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const cookieStore = await cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        },
      },
    }
  )

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { chosen_suggestion?: string } = {}
  try {
    body = await request.json()
  } catch {
    // body is optional
  }

  const { data: intent, error: fetchError } = await supabase
    .from('intents')
    .select('id, status')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (fetchError || !intent) {
    return NextResponse.json({ error: 'Intent not found' }, { status: 404 })
  }

  if (intent.status === 'confirmed') {
    return NextResponse.json({ error: 'Intent already confirmed' }, { status: 409 })
  }

  const { data: updated, error: updateError } = await supabase
    .from('intents')
    .update({
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
      chosen_suggestion: body.chosen_suggestion ?? null,
    })
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (updateError) {
    console.error('[intents/confirm] Update error:', updateError)
    return NextResponse.json({ error: 'Failed to confirm intent' }, { status: 500 })
  }

  await supabase.from('audit_log').insert({
    user_id: user.id,
    action: 'intent.confirmed',
    entity_type: 'intent',
    entity_id: id,
    metadata: { chosen_suggestion: body.chosen_suggestion ?? null },
  })

  return NextResponse.json({ intent: updated })
}
