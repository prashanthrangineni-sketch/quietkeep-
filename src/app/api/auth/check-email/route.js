// src/app/api/auth/check-email/route.js
// Server route to check if an email address is already registered in Supabase Auth

import { NextResponse } from 'next/server';
import { createWriteClient } from '@/lib/supabase-bearer';

export async function POST(req) {
  try {
    const { email } = await req.json();
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const norm = email.trim().toLowerCase();
    const db = createWriteClient();

    let exists = false;

    try {
      const { data: userList, error } = await db.auth.admin.listUsers();
      if (!error && userList?.users) {
        exists = userList.users.some(u => u.email?.toLowerCase() === norm);
      }
    } catch (e) {
      console.warn('[check-email] admin lookup failed:', e);
    }

    return NextResponse.json({ exists });
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
