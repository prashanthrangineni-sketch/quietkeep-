// src/app/api/caller-context/route.js
// QuietKeep Caller Context Moat API — Track A1
// Provides caller metadata, notes, khata/ledger status, and active keeps for a phone number.

import { createBearerClient, createWriteClient, unauthorized } from '@/lib/supabase-bearer';
import { resolveWorkspaceContext } from '@/lib/biz-rbac';
import { NextResponse } from 'next/server';

export async function GET(req) {
  const { user } = await createBearerClient(req);
  if (!user) return unauthorized();

  const { searchParams } = new URL(req.url);
  const rawPhone = (searchParams.get('phone') || '').trim();
  if (!rawPhone) {
    return NextResponse.json({ error: 'Phone parameter required' }, { status: 400 });
  }

  // Normalize phone for lookup (e.g. +919999900001 -> 9999900001)
  const cleanPhone = rawPhone.replace(/[^\d+]/g, '');
  const digitsOnly = cleanPhone.replace(/[^\d]/g, '');
  const last10 = digitsOnly.length >= 10 ? digitsOnly.slice(-10) : digitsOnly;

  const db = createWriteClient();

  // 1. Resolve contact
  let contact = null;
  const { data: contactsData } = await db
    .from('contacts')
    .select('id, name, phone, email, avatar_emoji, relation')
    .eq('user_id', user.id)
    .then(({ data, error }) => ({ data: error ? [] : data, error }));

  if (contactsData && contactsData.length > 0) {
    contact = contactsData.find(c => {
      if (!c.phone) return false;
      const cd = c.phone.replace(/[^\d]/g, '');
      return cd.endsWith(last10) || last10.endsWith(cd);
    }) || null;
  }

  // 2. Resolve business workspace customer & khata details (supports owners & staff accounts via resolveWorkspaceContext)
  let customer = null;
  let khata = null;

  const { workspace: wsData } = await resolveWorkspaceContext(req).catch(() => ({ workspace: null }));

  if (wsData?.id) {
    const { data: custData } = await db
      .from('business_customers')
      .select('id, name, phone, notes, outstanding_balance, last_transaction_date')
      .eq('workspace_id', wsData.id)
      .then(({ data, error }) => ({ data: error ? [] : data, error }));

    if (custData && custData.length > 0) {
      customer = custData.find(c => {
        if (!c.phone) return false;
        const cd = c.phone.replace(/[^\d]/g, '');
        return cd.endsWith(last10) || last10.endsWith(cd);
      }) || null;
    }

    if (customer) {
      // Find latest pending ledger entry for promise/days overdue details
      const { data: ledgerEntries } = await db
        .from('business_ledger')
        .select('amount, due_date, description, payment_status, transaction_date')
        .eq('workspace_id', wsData.id)
        .eq('party_phone', customer.phone)
        .eq('payment_status', 'pending')
        .order('transaction_date', { ascending: true })
        .then(({ data, error }) => ({ data: error ? [] : data, error }));

      let daysOverdue = 0;
      let lastPromise = null;

      if (ledgerEntries && ledgerEntries.length > 0) {
        const oldestPending = ledgerEntries[0];
        if (oldestPending.due_date) {
          const due = new Date(oldestPending.due_date);
          const now = new Date();
          const diffMs = now.getTime() - due.getTime();
          if (diffMs > 0) {
            daysOverdue = Math.floor(diffMs / (1000 * 60 * 60 * 24));
          }
        }
        lastPromise = oldestPending.description || null;
      }

      khata = {
        outstanding: customer.outstanding_balance || 0,
        days_overdue: daysOverdue,
        last_promise: lastPromise,
      };
    }
  }

  // 3. Resolve user keeps linked to this phone/contact
  const { data: userKeeps } = await db
    .from('keeps')
    .select('id, content, intent_type, reminder_at, status, created_at')
    .eq('user_id', user.id)
    .neq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(10)
    .then(({ data, error }) => ({ data: error ? [] : data, error }));

  const relevantKeeps = (userKeeps || []).filter(k => {
    const text = (k.content || '').toLowerCase();
    const targetName = (contact?.name || customer?.name || '').toLowerCase();
    return targetName ? text.includes(targetName) : false;
  });

  const notesList = [];
  if (customer?.notes) notesList.push(customer.notes);
  relevantKeeps.forEach(k => {
    if (k.content) notesList.push(k.content);
  });

  return NextResponse.json({
    phone: cleanPhone,
    name: contact?.name || customer?.name || 'Unknown Caller',
    avatar_emoji: contact?.avatar_emoji || '👤',
    relation: contact?.relation || null,
    notes: notesList,
    khata: khata || { outstanding: 0, days_overdue: 0, last_promise: null },
    keeps: relevantKeeps,
  });
}
