// src/app/api/auth/send-otp/route.js
// MSG91 SMS OTP Sending Service

import { NextResponse } from 'next/server';

export async function POST(req) {
  try {
    const { phone } = await req.json();
    if (!phone) {
      return NextResponse.json({ error: 'Mobile number is required' }, { status: 400 });
    }

    // Format phone to 91XXXXXXXXXX
    const cleanPhone = phone.replace(/\D/g, '');
    const mobile = cleanPhone.length === 10 ? '91' + cleanPhone : cleanPhone;

    const authKey = process.env.MSG91_AUTH_KEY;
    const templateId = process.env.MSG91_OTP_TEMPLATE_ID;

    if (!authKey) {
      return NextResponse.json({ error: 'MSG91_AUTH_KEY is not configured on server' }, { status: 500 });
    }

    // Call MSG91 Send OTP API
    const url = `https://control.msg91.com/api/v5/otp?template_id=${encodeURIComponent(templateId || '')}&mobile=${encodeURIComponent(mobile)}&authkey=${encodeURIComponent(authKey)}`;
    const res = await fetch(url, { method: 'POST' });
    const data = await res.json();

    if (data.type === 'success' || data.type === '200') {
      return NextResponse.json({ success: true, message: 'OTP sent successfully via MSG91' });
    } else {
      return NextResponse.json({ error: data.message || 'Failed to send OTP via MSG91' }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
