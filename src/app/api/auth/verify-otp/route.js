// src/app/api/auth/verify-otp/route.js
// MSG91 SMS OTP Verification Service

import { NextResponse } from 'next/server';
import { createWriteClient } from '@/lib/supabase-bearer';

// SECURITY FIX: the live MSG91 auth key was previously hardcoded here as a
// fallback default and got committed to git history in plaintext. It must be
// rotated in the MSG91 dashboard — this fix only stops the code from shipping
// a hardcoded secret going forward, it does not undo the exposure already in
// git history.
const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY;
if (!MSG91_AUTH_KEY) {
  console.error('MSG91_AUTH_KEY env var is not set — OTP verification will fail until it is configured in Vercel.');
}

export async function POST(req) {
  try {
    const { phone, otp } = await req.json();
    if (!phone || !otp) {
      return NextResponse.json({ error: 'Phone and OTP are required' }, { status: 400 });
    }

    const cleanPhone = phone.replace(/\D/g, '');
    const mobile = cleanPhone.length === 10 ? '91' + cleanPhone : cleanPhone;

    // Call MSG91 Verify OTP API
    const url = `https://control.msg91.com/api/v5/otp/verify?otp=${encodeURIComponent(otp)}&mobile=${encodeURIComponent(mobile)}&authkey=${encodeURIComponent(MSG91_AUTH_KEY)}`;
    const res = await fetch(url, { method: 'POST' });
    const data = await res.json();

    if (data.type === 'success' || data.type === '200') {
      const db = createWriteClient();
      const userEmail = `${mobile}@quietkeep.com`;

      // Provision or get user in Supabase auth
      let userId = null;
      try {
        const { data: newUser } = await db.auth.admin.createUser({
          email: userEmail,
          phone: '+' + mobile,
          email_confirm: true,
          user_metadata: { mobile, auth_provider: 'msg91' }
        });
        if (newUser && newUser.user) userId = newUser.user.id;
      } catch (e) {
        // User already exists
      }

      return NextResponse.json({
        success: true,
        message: 'OTP verified successfully',
        mobile,
        email: userEmail,
        user_id: userId
      });
    } else {
      return NextResponse.json({ error: data.message || 'Invalid or expired OTP' }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
