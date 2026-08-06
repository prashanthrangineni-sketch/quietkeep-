// src/app/api/auth/send-otp/route.js
// MSG91 SMS OTP Sending Service — QuietKeep DLT templates

import { NextResponse } from 'next/server';

// SECRET → environment only. Never hardcode/commit this.
const MSG91_AUTH_KEY = (process.env.MSG91_AUTH_KEY || '').trim();
const MSG91_SENDER_ID = (process.env.MSG91_SENDER_ID || 'PRANIX').trim();

// DLT template IDs are PUBLIC identifiers (they appear in every OTP SMS) — NOT
// secrets. Bound directly so OTP can't break again on an env/deploy mismatch.
// These are QuietKeep's DLT-verified MSG91 OTP templates:
//   personal  -> "Your OTP for login to QUIETKEEP is ##OTP##..."
//   business  -> "Your OTP for business login to QUIETKEEP is ##OTP##..."
const DLT_PERSONAL_TEMPLATE_ID = '6a638db8f2ff0c59980e48f2';
const DLT_BUSINESS_TEMPLATE_ID = '6a638dc459c32acfaf0615e2';

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

    // Call MSG91 Send OTP API
    const url = `https://control.msg91.com/api/v5/otp?template_id=${encodeURIComponent(templateId)}&mobile=${encodeURIComponent(mobile)}&authkey=${encodeURIComponent(MSG91_AUTH_KEY)}&sender=${encodeURIComponent(MSG91_SENDER_ID)}`;
    const res = await fetch(url, { method: 'POST' });
    const data = await res.json();

    if (data.type === 'success' || data.type === '200') {
      return NextResponse.json({
        success: true,
        message: `OTP sent successfully via MSG91 (${type} template)`,
      });
    } else {
      return NextResponse.json({ error: data.message || 'Failed to send OTP via MSG91' }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
