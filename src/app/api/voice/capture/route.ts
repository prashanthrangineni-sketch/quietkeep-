export const dynamic = 'force-dynamic'

import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { parseIntent } from '@/lib/intent-parser'

export async function POST(request: NextRequest) {
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

  let body: { transcript?: string; source?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { transcript, source = 'voice' } = body

  if (!transcript || typeof transcript !== 'string' || transcript.trim().length === 0) {
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

  // Audit log
  await supabase.from('audit_log').insert({
    user_id: user.id,
    action: 'intent.captured',
    entity_type: 'intent',
    entity_id: intent.id,
    metadata: { source, confidence: parsed.confidence },
  })

  return NextResponse.json({ intent }, { status: 201 })
}
