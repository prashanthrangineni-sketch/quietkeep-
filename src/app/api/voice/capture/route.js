export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { parseIntent } from '@/lib/intent-parser'

export async function POST(request) {
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { transcript, source = 'voice' } = body

  if (!transcript || transcript.trim().length === 0) {
    return NextResponse.json({ error: 'transcript is required' }, { status: 400 })
  }

  const parsed = parseIntent(transcript.trim())

  const { data: intent, error: insertError } = await supabase
    .from('intents')
    .insert({
      user_id: user.id,
      raw_text: transcript.trim(),
      intent_type: parsed.type,
      subject: parsed.subject,
      action: parsed.action,
      confidence: parsed.confidence,
      metadata: { source, ...parsed.metadata },
      status: 'pending',
    })
    .select()
    .single()

  if (insertError) {
    console.error('[voice/capture] Insert error:', insertError)
    return NextResponse.json({ error: 'Failed to save intent' }, { status: 500 })
  }

  await supabase.from('audit_log').insert({
    user_id: user.id,
    action: 'intent.captured',
    entity_type: 'intent',
    entity_id: intent.id,
    metadata: { source, confidence: parsed.confidence },
  })

  return NextResponse.json({ intent }, { status: 201 })
}
