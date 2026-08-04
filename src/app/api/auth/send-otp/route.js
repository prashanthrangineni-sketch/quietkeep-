// src/app/api/auth/send-otp/route.js
// MSG91 SMS OTP Sending Service with DLT Template Binding

import { NextResponse } from 'next/server';

const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY || '533749AJNRa3XXw5u6a34f4f6P1';
const DLT_PERSONAL_TEMPLATE_ID = process.env.MSG91_PERSONAL_TEMPLATE_ID || '1777178489105417057';
const DLT_BUSINESS_TEMPLATE_ID = process.env.MSG91_BUSINESS_TEMPLATE_ID || '1777178489113625810';

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
