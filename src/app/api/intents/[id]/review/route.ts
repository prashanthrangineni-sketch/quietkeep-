export const dynamic = 'force-dynamic'

import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { generateSuggestions } from '@/lib/suggestion-engine'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createSupabaseServerClient()

  const { id } = params

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

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

  // Persist suggestions
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
