export const dynamic = 'force-dynamic'

import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { generateSuggestions } from '@/lib/suggestion-engine'

export async function GET(
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

  const { data: intent, error } = await supabase
    .from('intents')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !intent) {
    return NextResponse.json({ error: 'Intent not found' }, { status: 404 })
  }

  const suggestions = generateSuggestions(intent)

  // Persist suggestions back to intent row
  await supabase
    .from('intents')
    .update({ suggestions })
    .eq('id', id)
    .eq('user_id', user.id)

  await supabase.from('audit_log').insert({
    user_id: user.id,
    action: 'intent.reviewed',
    entity_type: 'intent',
    entity_id: id,
    metadata: { suggestion_count: suggestions.length },
  })

  return NextResponse.json({ intent: { ...intent, suggestions } })
}
