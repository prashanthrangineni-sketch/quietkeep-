// src/app/api/auth/verify-otp/route.js
// MSG91 SMS OTP Verification Service with Real Supabase Session Minting

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createWriteClient } from '@/lib/supabase-bearer';

const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY;

export async function POST(req) {
  try {
    const { phone, otp } = await req.json();
    if (!phone || !otp) {
      return NextResponse.json({ error: 'Phone and OTP are required' }, { status: 400 });
    }

    const cleanPhone = phone.replace(/\D/g, '');
    const mobile = cleanPhone.length === 10 ? '91' + cleanPhone : cleanPhone;

    if (!MSG91_AUTH_KEY) {
      return NextResponse.json({ error: 'MSG91_AUTH_KEY is not configured on server' }, { status: 500 });
    }

    // Call MSG91 Verify OTP API
    const url = `https://control.msg91.com/api/v5/otp/verify?otp=${encodeURIComponent(otp)}&mobile=${encodeURIComponent(mobile)}&authkey=${encodeURIComponent(MSG91_AUTH_KEY)}`;
    const res = await fetch(url, { method: 'POST' });
    const data = await res.json();

    if (data.type === 'success' || data.type === '200') {
      const db = createWriteClient();
      const userEmail = `${mobile}@quietkeep.com`;

      // 1. Look up existing user by email or phone
      let user = null;
      try {
        const { data: userList } = await db.auth.admin.listUsers();
        user = (userList?.users || []).find(u => u.email === userEmail || u.phone === '+' + mobile);
      } catch (e) {
        console.warn('[verify-otp] listUsers warning:', e);
      }

      // 2. Create user if not existing
      if (!user) {
        try {
          const { data: newUser } = await db.auth.admin.createUser({
            email: userEmail,
            phone: '+' + mobile,
            email_confirm: true,
            user_metadata: { mobile, auth_provider: 'msg91' }
          });
          if (newUser && newUser.user) {
            user = newUser.user;
          }
        } catch (createErr) {
          console.warn('[verify-otp] createUser fallback:', createErr);
        }
      }

      // 3. Mint usable Supabase Session via generateLink -> verifyOtp token exchange
      let session = null;
      try {
        const { data: linkData } = await db.auth.admin.generateLink({
          type: 'magiclink',
          email: userEmail,
        });

        if (linkData?.properties?.hashed_token) {
          const anonClient = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
          );
          const { data: verifyData } = await anonClient.auth.verifyOtp({
            token_hash: linkData.properties.hashed_token,
            type: 'magiclink',
          });
          if (verifyData?.session) {
            session = verifyData.session;
          }
        }
      } catch (sessionErr) {
        console.error('[verify-otp] session minting error:', sessionErr);
      }

      return NextResponse.json({
        success: true,
        message: 'OTP verified successfully',
        mobile,
        email: userEmail,
        user_id: user ? user.id : (session ? session.user.id : null),
        session: session ? {
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_in: session.expires_in,
          expires_at: session.expires_at,
          token_type: session.token_type,
          user: session.user
        } : null
      });
    } else {
      return NextResponse.json({ error: data.message || 'Invalid or expired OTP' }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
