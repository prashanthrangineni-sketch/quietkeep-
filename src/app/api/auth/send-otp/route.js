// src/app/api/auth/send-otp/route.js
// MSG91 OTP via SMS Flow API — same delivery route QuickScanz uses.
// We generate the 6-digit code ourselves, send it through the DLT-approved
// SMS template, and hand back a signed token so verify-otp can validate the
// code without any database state.

import { NextResponse } from 'next/server';
import crypto from 'crypto';

// SECRET → environment only. Never hardcode/commit this.
const MSG91_AUTH_KEY = (process.env.MSG91_AUTH_KEY || '').trim();
const MSG91_SENDER_ID = (process.env.MSG91_SENDER_ID || 'PRANIX').trim();

// DLT template IDs are PUBLIC identifiers (they appear in every OTP SMS) — NOT secrets.
//   personal  -> "Your OTP for login to QUIETKEEP is ##OTP##..."
//   business  -> "Your OTP for business login to QUIETKEEP is ##OTP##..."
const DLT_PERSONAL_TEMPLATE_ID = '6a638db8f2ff0c59980e48f2';
const DLT_BUSINESS_TEMPLATE_ID = '6a638dc459c32acfaf0615e2';

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes, matches template copy

function signOtp(mobile, otp, expiry) {
  return crypto
    .createHmac('sha256', MSG91_AUTH_KEY)
    .update(`${mobile}.${otp}.${expiry}`)
    .digest('hex');
}

if (!MSG91_AUTH_KEY) {
  console.error('MSG91_AUTH_KEY env var is not set — OTP sending will fail until it is configured in Vercel.');
}

export async function POST(req) {
  try {
    const { phone, type = 'personal' } = await req.json();
    if (!phone) {
      return NextResponse.json({ error: 'Mobile number is required' }, { status: 400 });
    }

    // Format phone to 91XXXXXXXXXX
    const cleanPhone = phone.replace(/\D/g, '');
    const mobile = cleanPhone.length === 10 ? '91' + cleanPhone : cleanPhone;

    const templateId = type === 'business' ? DLT_BUSINESS_TEMPLATE_ID : DLT_PERSONAL_TEMPLATE_ID;

    // Generate the OTP server-side (QuickScanz pattern).
    const otp = String(crypto.randomInt(100000, 1000000));
    const expiry = Date.now() + OTP_TTL_MS;

    // MSG91 SMS Flow API — the route that actually delivers SMS-product templates.
    // Variable keys cover the common DLT naming variants; extras are ignored.
    const res = await fetch('https://control.msg91.com/api/v5/flow/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authkey: MSG91_AUTH_KEY },
      body: JSON.stringify({
        template_id: templateId,
        sender: MSG91_SENDER_ID,
        short_url: '0',
        recipients: [{ mobiles: mobile, OTP: otp, otp: otp, VAR1: otp, var1: otp }],
      }),
    });
    const data = await res.json();

    if (data.type === 'success') {
      // Stateless verification token: base64(JSON{mobile, expiry, signature}).
      const otpToken = Buffer.from(
        JSON.stringify({ m: mobile, e: expiry, s: signOtp(mobile, otp, expiry) })
      ).toString('base64');

      return NextResponse.json({
        success: true,
        message: `OTP sent successfully via MSG91 (${type} template)`,
        otpToken,
      });
    } else {
      console.error('[send-otp] MSG91 flow error:', data);
      return NextResponse.json({ error: data.message || 'Failed to send OTP via MSG91' }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
