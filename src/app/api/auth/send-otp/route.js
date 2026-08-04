// src/app/api/auth/send-otp/route.js
// MSG91 SMS OTP Sending Service with DLT Template Binding

import { NextResponse } from 'next/server';

// SECURITY FIX: the live MSG91 auth key and DLT template IDs were previously
// hardcoded here as fallback defaults and got committed to git history in
// plaintext. That key must be rotated in the MSG91 dashboard — this fix only
// stops the code from shipping a hardcoded secret going forward, it does not
// undo the exposure already in git history.
const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY;
const DLT_PERSONAL_TEMPLATE_ID = process.env.MSG91_PERSONAL_TEMPLATE_ID;
const DLT_BUSINESS_TEMPLATE_ID = process.env.MSG91_BUSINESS_TEMPLATE_ID;

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
    const url = `https://control.msg91.com/api/v5/otp?template_id=${encodeURIComponent(templateId)}&mobile=${encodeURIComponent(mobile)}&authkey=${encodeURIComponent(MSG91_AUTH_KEY)}&sender=PRANIX`;
    const res = await fetch(url, { method: 'POST' });
    const data = await res.json();

    if (data.type === 'success' || data.type === '200') {
      return NextResponse.json({
        success: true,
        message: `OTP sent successfully via MSG91 (${type} template)`,
        templateId
      });
    } else {
      return NextResponse.json({ error: data.message || 'Failed to send OTP via MSG91' }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
