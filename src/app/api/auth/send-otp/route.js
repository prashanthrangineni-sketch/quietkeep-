// src/app/api/auth/send-otp/route.js
// MSG91 SMS OTP Sending Service with DLT Template Binding

import { NextResponse } from 'next/server';

// Trim to defend against a stray space/newline pasted into the Vercel value,
// which makes MSG91 reject the template_id as "invalid".
const MSG91_AUTH_KEY = (process.env.MSG91_AUTH_KEY || '').trim();
const DLT_PERSONAL_TEMPLATE_ID = (process.env.MSG91_PERSONAL_TEMPLATE_ID || '').trim();
const DLT_BUSINESS_TEMPLATE_ID = (process.env.MSG91_BUSINESS_TEMPLATE_ID || '').trim();
const MSG91_SENDER_ID = (process.env.MSG91_SENDER_ID || 'PRANIX').trim();

if (!MSG91_AUTH_KEY) {
  console.error('MSG91_AUTH_KEY env var is not set — OTP sending will fail until it is configured in Vercel.');
}

// TEMPORARY diagnostic — lets us confirm the live config without exposing secrets.
// Remove once phone OTP is confirmed working.
export async function GET() {
  return NextResponse.json({
    diagnostic: true,
    hasAuthKey: MSG91_AUTH_KEY.length > 0,
    authKeyLength: MSG91_AUTH_KEY.length,
    sender: MSG91_SENDER_ID,
    personalTemplateId: DLT_PERSONAL_TEMPLATE_ID,
    personalTemplateLength: DLT_PERSONAL_TEMPLATE_ID.length,
    businessTemplateId: DLT_BUSINESS_TEMPLATE_ID,
    businessTemplateLength: DLT_BUSINESS_TEMPLATE_ID.length,
  });
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

    const templateId = (type === 'business' ? DLT_BUSINESS_TEMPLATE_ID : DLT_PERSONAL_TEMPLATE_ID) || DLT_PERSONAL_TEMPLATE_ID;

    // Call MSG91 Send OTP API
    const url = `https://control.msg91.com/api/v5/otp?template_id=${encodeURIComponent(templateId)}&mobile=${encodeURIComponent(mobile)}&authkey=${encodeURIComponent(MSG91_AUTH_KEY)}&sender=${encodeURIComponent(MSG91_SENDER_ID)}`;
    const res = await fetch(url, { method: 'POST' });
    const data = await res.json();

    if (data.type === 'success' || data.type === '200') {
      return NextResponse.json({
        success: true,
        message: `OTP sent successfully via MSG91 (${type} template)`,
        templateId
      });
    } else {
      return NextResponse.json({
        error: data.message || 'Failed to send OTP via MSG91',
        _debug: {
          templateIdUsed: templateId,
          templateIdLength: templateId.length,
          hasAuthKey: MSG91_AUTH_KEY.length > 0,
          sender: MSG91_SENDER_ID,
          msg91: data,
        }
      }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
