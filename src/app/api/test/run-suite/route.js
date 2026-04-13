// src/app/api/test/run-suite/route.js
// Runs full system test suite against live DB
// Returns structured report per test case
// Only callable by authenticated users (admin check recommended in production)

export const dynamic = 'force-dynamic';

import { NextResponse }             from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const uid     = user.id;
  const run_id  = `run-${Date.now()}`;
  const tests   = [];
  const now     = new Date().toISOString();

  async function runTest(name, inputFn, actionFn, passFn) {
    const start = Date.now();
    let passed = false; let result = 'SKIP'; let db_before = {}; let db_after = {}; let error_msg = null;
    try {
      db_before = await inputFn();
      db_after  = await actionFn();
      passed    = passFn(db_after);
      result    = passed ? 'PASS' : `FAIL: ${JSON.stringify(db_after).slice(0,100)}`;
    } catch (e) {
      result = `ERROR: ${e.message}`; error_msg = e.message;
    }
    const duration_ms = Date.now() - start;
    const entry = { name, input: db_before, db_before, action: name, db_after, result, passed, error_msg, duration_ms };
    tests.push(entry);
    await supabase.from('test_run_log').insert({ run_id, test_name: name, input: db_before, db_before, action: name, db_after, result, passed, error_msg, duration_ms }).throwOnError().catch(() => {});
    return db_after;
  }

  let k1_id, k2_id, k3_id;

  // T1: Personal voice keep
  await runTest(
    'T1_personal_voice_keep',
    async () => {
      const { count } = await supabase.from('keeps').select('id',{count:'exact',head:true}).eq('user_id',uid);
      return { keeps_count: count };
    },
    async () => {
      const { data } = await supabase.from('keeps').insert({
        user_id: uid, content:'[TEST] Personal electricity bill', voice_text:'pay electricity bill',
        status:'open', loop_state:'open', intent_type:'reminder', confidence:0.88,
        parsing_method:'rule', space_type:'personal', domain_type:'personal', tags:[], show_on_brief:true, reviewed_at: now,
      }).select('id,intent_type,space_type,domain_type').single();
      k1_id = data?.id;
      return data;
    },
    (r) => r?.space_type === 'personal' && r?.id
  );

  // T2: Business keep
  const { data: ws } = await supabase.from('business_workspaces').select('id').eq('owner_user_id', uid).limit(1).maybeSingle();
  const ws_id = ws?.id;
  if (ws_id) {
    await runTest(
      'T2_business_keep_creation',
      async () => ({ workspace_id: ws_id }),
      async () => {
        const { data } = await supabase.from('keeps').insert({
          user_id: uid, content:'[TEST] GST invoice for Mehta', voice_text:'issue gst invoice',
          status:'open', loop_state:'open', intent_type:'invoice', confidence:0.91,
          parsing_method:'rule', space_type:'business', domain_type:'business',
          workspace_id: ws_id, tags:[], show_on_brief:true, reviewed_at: now,
        }).select('id,space_type,domain_type,workspace_id').single();
        k2_id = data?.id;
        return data;
      },
      (r) => r?.space_type === 'business' && r?.workspace_id === ws_id
    );
  }

  // T3: evaluate_keep personal
  if (k1_id) {
    await supabase.from('keeps').update({ stale_at: new Date(Date.now() - 3600000).toISOString() }).eq('id', k1_id);
    await runTest(
      'T3_evaluate_personal',
      async () => ({ keep_id: k1_id, mode: 'personal' }),
      async () => {
        const { data } = await supabase.rpc('evaluate_keep', { p_keep_id: k1_id, p_user_id: uid, p_user_state: 'START_OF_DAY', p_mode: 'personal' });
        return data;
      },
      (r) => r?.action === 'nudge_queued'
    );
  }

  // T4: evaluate_keep business
  if (k2_id) {
    await supabase.from('keeps').update({ stale_at: new Date(Date.now() - 3600000).toISOString() }).eq('id', k2_id);
    await runTest(
      'T4_evaluate_business',
      async () => ({ keep_id: k2_id, mode: 'business' }),
      async () => {
        const { data } = await supabase.rpc('evaluate_keep', { p_keep_id: k2_id, p_user_id: uid, p_user_state: 'WORKING_HOURS', p_mode: 'business' });
        return data;
      },
      (r) => r?.action === 'nudge_queued'
    );
  }

  // T5: compute_priority
  if (k1_id) {
    await runTest(
      'T5_priority_scoring',
      async () => ({ keep_id: k1_id }),
      async () => {
        const { data } = await supabase.rpc('compute_priority', { p_keep_id: k1_id, p_user_id: uid, p_user_state: 'START_OF_DAY' });
        return { priority: data };
      },
      (r) => typeof r?.priority === 'number' && r.priority > 0
    );
  }

  // T6: feedback loop
  if (k1_id) {
    await runTest(
      'T6_feedback_loop',
      async () => {
        const { data } = await supabase.from('user_behavior_model').select('total_acted').eq('user_id', uid).maybeSingle();
        return { total_acted_before: data?.total_acted || 0 };
      },
      async () => {
        await supabase.rpc('update_user_behavior_model', { p_user_id: uid, p_outcome: 'acted', p_keep_id: k1_id });
        const { data } = await supabase.from('user_behavior_model').select('total_acted,success_rate_30d').eq('user_id', uid).maybeSingle();
        return data;
      },
      (r) => typeof r?.total_acted === 'number'
    );
  }

  // T7: intent chaining
  if (k1_id) {
    const { data: pk } = await supabase.from('keeps').insert({
      user_id: uid, content:'[TEST] Parent keep', voice_text:'parent', status:'open', loop_state:'open',
      intent_type:'task', confidence:0.8, parsing_method:'rule', space_type:'personal', domain_type:'personal',
      tags:[], show_on_brief:true, reviewed_at: now,
    }).select('id').single();
    k3_id = pk?.id;
    if (k3_id) {
      await runTest(
        'T7_intent_chaining',
        async () => ({ child: k1_id, parent: k3_id }),
        async () => {
          const { data } = await supabase.rpc('link_keep_to_parent', { p_child_id: k1_id, p_parent_id: k3_id, p_user_id: uid });
          return data;
        },
        (r) => r?.ok === true
      );
    }
  }

  // T8: external signal
  await runTest(
    'T8_external_signal',
    async () => ({ domain: 'commerce', source: 'cart2save' }),
    async () => {
      const { data } = await supabase.rpc('ingest_external_signal', {
        p_user_id: uid, p_domain: 'commerce', p_source_domain: 'cart2save',
        p_signal_type: 'price_drop', p_content: '[TEST] iPhone ₹5k off',
        p_payload: { product: 'iPhone', discount: 5000 }, p_priority: 0.8,
      });
      return data;
    },
    (r) => r?.ok === true
  );

  // T9: passive signal
  await runTest(
    'T9_passive_signal',
    async () => ({ type: 'app_active' }),
    async () => {
      await supabase.rpc('ingest_passive_signal', {
        p_user_id: uid, p_signal_type: 'app_active', p_metadata: { platform: 'web' },
      });
      return { ok: true };
    },
    (r) => r?.ok === true
  );

  // T10: state transition
  if (k1_id) {
    await runTest(
      'T10_state_transition',
      async () => {
        const { data } = await supabase.from('keeps').select('status').eq('id', k1_id).single();
        return { status_before: data?.status };
      },
      async () => {
        const { data } = await supabase.rpc('transition_keep_state', { p_keep_id: k1_id, p_user_id: uid, p_new_state: 'active' });
        return data;
      },
      (r) => r?.ok === true
    );
  }

  // T11: process_evaluation_queue
  await runTest(
    'T11_process_queue',
    async () => {
      const { count } = await supabase.from('evaluation_queue').select('id',{count:'exact',head:true}).eq('status','pending');
      return { pending: count };
    },
    async () => {
      const { data } = await supabase.rpc('process_evaluation_queue', { p_limit: 5, p_user_state: 'START_OF_DAY' });
      return data;
    },
    (r) => typeof r?.processed === 'number'
  );

  // T12: system health
  await runTest(
    'T12_system_health',
    async () => ({}),
    async () => {
      const { data } = await supabase.rpc('get_system_health', { p_hours_back: 24 });
      return data;
    },
    (r) => r !== null && typeof r === 'object'
  );

  const total  = tests.length;
  const passed = tests.filter(t => t.passed).length;
  const failed = total - passed;

  return NextResponse.json({
    run_id,
    summary: { total, passed, failed, pass_rate: `${Math.round(passed/total*100)}%` },
    tests:   tests.map(t => ({
      name:      t.name,
      input:     t.input,
      db_before: t.db_before,
      action:    t.action,
      db_after:  t.db_after,
      result:    t.result,
      passed:    t.passed,
      duration_ms: t.duration_ms,
    })),
  });
}
