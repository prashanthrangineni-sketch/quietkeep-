-- Migration: 20261025_delete_user_data.sql
-- Function to atomically clean up all user data and delete auth.users record.
-- Required for Play Store account deletion compliance (AG-AARIA-26).

create or replace function public.delete_user_data(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_counts jsonb := '{}'::jsonb;
  v_count integer;
begin
  if p_user is null then
    return jsonb_build_object('ok', false, 'error', 'p_user required');
  end if;

  -- 1. Disassociate shared business rows (set creator/marker column to NULL)
  update attendance_logs set marked_by = null where marked_by = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('attendance_logs', v_count);

  update business_ledger set created_by = null where created_by = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('business_ledger', v_count);

  update business_tasks set created_by = null where created_by = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('business_tasks', v_count);

  update business_chat_rooms set created_by = null where created_by = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('business_chat_rooms', v_count);

  update business_payments set created_by = null where created_by = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('business_payments', v_count);

  update business_dunning_log set created_by = null where created_by = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('business_dunning_log', v_count);

  update profiles set parent_user_id = null where parent_user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('profiles_parent_user_id', v_count);

  -- 2. Delete user's own business chat messages
  delete from business_chat_messages where sender_id::text = p_user::text;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('business_chat_messages', v_count);

  -- 3. Delete dependent child records
  delete from intent_suggestions where intent_id in (select id from intents where user_id = p_user);
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('intent_suggestions', v_count);

  delete from intent_events where user_id = p_user or intent_id in (select id from intents where user_id = p_user);
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('intent_events', v_count);

  delete from intent_actions where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('intent_actions', v_count);

  delete from decision_logs where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('decision_logs', v_count);

  delete from decision_logs_archive where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('decision_logs_archive', v_count);

  delete from audit_log where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('audit_log', v_count);

  delete from audit_log_archive where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('audit_log_archive', v_count);

  delete from notifications_sent where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('notifications_sent', v_count);

  delete from reminders where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('reminders', v_count);

  delete from expense_splits where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('expense_splits', v_count);

  delete from expenses where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('expenses', v_count);

  delete from voice_sessions where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('voice_sessions', v_count);

  delete from voice_samples where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('voice_samples', v_count);

  -- Delete intents AFTER expenses, voice_sessions, reminders, audit_log, decision_logs
  delete from intents where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('intents', v_count);

  delete from memory_items where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('memory_items', v_count);

  delete from memories where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('memories', v_count);

  delete from kids_activity where parent_user_id = p_user or child_user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('kids_activity', v_count);

  delete from kids_content where user_id = p_user or parent_user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('kids_content', v_count);

  delete from kids_profiles where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('kids_profiles', v_count);

  -- 2c. Delete whatsapp_ocr_queue BEFORE products
  delete from whatsapp_ocr_queue where user_id = p_user or product_id in (select id from products where user_id = p_user);
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('whatsapp_ocr_queue', v_count);

  delete from replacement_plans where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('replacement_plans', v_count);

  delete from product_usage_logs where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('product_usage_logs', v_count);

  delete from products where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('products', v_count);

  delete from contact_group_members where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('contact_group_members', v_count);

  delete from contact_groups where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('contact_groups', v_count);

  delete from contacts where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('contacts', v_count);

  delete from business_approvals where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('business_approvals', v_count);

  -- 2a. Clear business_tasks assigned to this user's business_members rows before member deletion
  update business_tasks
     set assigned_to_member_id = null
   where assigned_to_member_id in (select id from business_members where user_id = p_user);
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('business_tasks_assigned_member', v_count);

  delete from business_members where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('business_members', v_count);

  -- 2b. Clear reply_to_id in qk_messages pointing to this user's messages before message deletion
  update qk_messages
     set reply_to_id = null
   where reply_to_id in (select id from qk_messages where sender_id::text = p_user::text);
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('qk_messages_reply_to', v_count);

  delete from qk_messages where sender_id::text = p_user::text;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('qk_messages', v_count);

  delete from qk_connections where receiver_id = p_user or requester_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('qk_connections', v_count);

  -- 4. Delete user rows from tables in Items 1 and 3
  delete from calendar_events where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('calendar_events', v_count);

  delete from daily_usage where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('daily_usage', v_count);

  delete from predictive_suggestions where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('predictive_suggestions', v_count);

  delete from tau_behaviour_profile where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('tau_behaviour_profile', v_count);

  delete from tau_intent_log where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('tau_intent_log', v_count);

  delete from user_consent where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('user_consent', v_count);

  delete from user_location_patterns where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('user_location_patterns', v_count);

  delete from user_locations where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('user_locations', v_count);

  delete from user_connectors where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('user_connectors', v_count);

  delete from user_behavior_model where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('user_behavior_model', v_count);

  delete from user_settings where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('user_settings', v_count);

  delete from signal_correlator_log where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('signal_correlator_log', v_count);

  delete from connector_logs where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('connector_logs', v_count);

  delete from behaviour_signals_archive where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('behaviour_signals_archive', v_count);

  delete from behaviour_signals where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('behaviour_signals', v_count);

  delete from behavior_patterns where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('behavior_patterns', v_count);

  -- 5. Delete all remaining user-scoped public tables
  delete from asset_holdings where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('asset_holdings', v_count);

  delete from bill_reminders where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('bill_reminders', v_count);

  delete from brief_settings where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('brief_settings', v_count);

  delete from budgets where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('budgets', v_count);

  delete from conversation_sessions where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('conversation_sessions', v_count);

  delete from delivery_simulations where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('delivery_simulations', v_count);

  delete from device_tokens where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('device_tokens', v_count);

  delete from documents where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('documents', v_count);

  delete from driving_sessions where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('driving_sessions', v_count);

  delete from emergency_contacts where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('emergency_contacts', v_count);

  delete from evaluation_queue where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('evaluation_queue', v_count);

  delete from execution_queue where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('execution_queue', v_count);

  delete from family_invites where owner_user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('family_invites', v_count);

  delete from family_members where member_user_id = p_user or owner_user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('family_members', v_count);

  delete from family_profiles where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('family_profiles', v_count);

  delete from geo_events where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('geo_events', v_count);

  delete from geo_trigger_log where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('geo_trigger_log', v_count);

  delete from google_oauth_states where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('google_oauth_states', v_count);

  delete from health_logs where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('health_logs', v_count);

  delete from mood_logs where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('mood_logs', v_count);

  delete from nudge_queue where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('nudge_queue', v_count);

  delete from proactive_nudges where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('proactive_nudges', v_count);

  delete from realtime_events where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('realtime_events', v_count);

  delete from referral_codes where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('referral_codes', v_count);

  delete from referral_uses where referee_user_id = p_user or referrer_user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('referral_uses', v_count);

  delete from route_keeps where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('route_keeps', v_count);

  delete from share_tokens where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('share_tokens', v_count);

  delete from sos_events where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('sos_events', v_count);

  delete from subscriptions where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('subscriptions', v_count);

  delete from trip_plans where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('trip_plans', v_count);

  delete from usage_logs where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('usage_logs', v_count);

  delete from voice_profile_consents where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('voice_profile_consents', v_count);

  delete from whatsapp_outbound where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('whatsapp_outbound', v_count);

  delete from whatsapp_sessions where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('whatsapp_sessions', v_count);

  delete from admin_users where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('admin_users', v_count);

  delete from ai_predictions where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('ai_predictions', v_count);

  delete from ai_usage where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('ai_usage', v_count);

  delete from api_keys where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('api_keys', v_count);

  delete from keeps where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('keeps', v_count);

  delete from profiles where user_id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('profiles', v_count);

  -- 6. Tables from subsequent migrations (executed if present)
  if to_regclass('public.fuel_fills') is not null then
    execute 'delete from public.fuel_fills where user_id = $1' using p_user;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('fuel_fills', v_count);
  end if;

  if to_regclass('public.vehicles') is not null then
    execute 'delete from public.vehicles where user_id = $1' using p_user;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('vehicles', v_count);
  end if;

  if to_regclass('public.blackbox_events') is not null then
    execute 'delete from public.blackbox_events where owner = $1' using p_user;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('blackbox_events', v_count);
  end if;

  if to_regclass('public.drive_proof_runs') is not null then
    execute 'delete from public.drive_proof_runs where owner = $1' using p_user;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('drive_proof_runs', v_count);
  end if;

  -- 7. Finally delete from auth.users (cascades any remaining FKs)
  delete from auth.users where id = p_user;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('auth_users', v_count);

  return v_counts;
end;
$$;

revoke all on function public.delete_user_data(uuid) from public;
revoke all on function public.delete_user_data(uuid) from anon;
revoke all on function public.delete_user_data(uuid) from authenticated;
grant execute on function public.delete_user_data(uuid) to service_role;
