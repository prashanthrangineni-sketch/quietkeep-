/**
 * src/lib/capacitor/realtime.ts
 * 
 * Supabase Realtime subscription for push-based evaluation loop.
 * Replaces polling with WebSocket-based event listener.
 * 
 * Subscribes to:
 *   behaviour_signals INSERT → triggers evaluation
 *   nudge_queue INSERT → triggers proactive-nudges
 * 
 * Usage (call once after auth):
 *   const unsub = startRealtimeLoop(supabase, userId, onNudge)
 *   // on logout:
 *   unsub()
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type NudgeCallback = (nudge: {
  id: string;
  title: string;
  body: string;
  keep_id?: string;
  nudge_type: string;
}) => void;

let channel: any = null;

export function startRealtimeLoop(
  supabase: SupabaseClient,
  userId: string,
  onNudge?: NudgeCallback
): () => void {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }

  channel = supabase
    .channel(`user-${userId}-engine`)

    // 1. Listen for new behaviour_signals → trigger evaluation via relay
    .on(
      'postgres_changes' as any,
      {
        event: 'INSERT',
        schema: 'public',
        table: 'behaviour_signals',
        filter: `user_id=eq.${userId}`,
      },
      async (payload: any) => {
        const signal = payload.new;
        if (!signal?.source_id || signal.signal_type === 'nudge_queued') return;

        // Trigger realtime-relay edge function (non-blocking)
        fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/realtime-relay`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({
            type: 'signal',
            record: {
              keep_id: signal.source_id,
              user_id: signal.user_id,
              signal_type: signal.signal_type,
            },
          }),
        }).catch(() => {});
      }
    )

    // 2. Listen for new nudge_queue entries → display in-app notification
    .on(
      'postgres_changes' as any,
      {
        event: 'INSERT',
        schema: 'public',
        table: 'nudge_queue',
        filter: `user_id=eq.${userId}`,
      },
      async (payload: any) => {
        const nudge = payload.new;
        if (nudge && onNudge) {
          onNudge({
            id: nudge.id,
            title: nudge.title,
            body: nudge.body,
            keep_id: nudge.keep_id,
            nudge_type: nudge.nudge_type,
          });
        }

        // Trigger delivery (push/WhatsApp/email) immediately
        fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/proactive-nudges`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
          },
          body: '{}',
        }).catch(() => {});
      }
    )

    .subscribe((status: string) => {
      if (status === 'SUBSCRIBED') {
        console.log('[realtime] subscribed to engine events for', userId);
      }
    });

  // Return unsubscribe function
  return () => {
    if (channel) {
      supabase.removeChannel(channel);
      channel = null;
    }
  };
}
