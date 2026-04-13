// src/app/api/email/route.js
// Resend email templates: welcome, referral reward, weekly digest, invoice
// Requires: RESEND_API_KEY env var in Vercel
// Resend docs: https://resend.com/docs

export const runtime = 'nodejs';

const RESEND_API = 'https://api.resend.com/emails';
const FROM = 'QuietKeep <hello@quietkeep.com>';
const REPLY_TO = 'hello@quietkeep.com';

// ── HTML email templates ────────────────────────────────────────────────────

function baseLayout(content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>QuietKeep</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif; background: #f4f6fb; color: #1e293b; }
    .wrap { max-width: 580px; margin: 0 auto; padding: 32px 16px 48px; }
    .card { background: #fff; border-radius: 16px; padding: 32px 28px; border: 1px solid #e2e8f0; }
    .logo { font-size: 20px; font-weight: 800; color: #5b5ef4; letter-spacing: -0.5px; margin-bottom: 28px; }
    .logo span { font-size: 13px; font-weight: 500; color: #64748b; margin-left: 8px; }
    h1 { font-size: 24px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 12px; color: #0f172a; }
    p { font-size: 15px; color: #475569; line-height: 1.7; margin-bottom: 16px; }
    .btn { display: inline-block; background: #5b5ef4; color: #fff; text-decoration: none; padding: 13px 28px; border-radius: 10px; font-size: 15px; font-weight: 700; margin: 8px 0 16px; }
    .divider { height: 1px; background: #e2e8f0; margin: 24px 0; }
    .small { font-size: 12px; color: #94a3b8; line-height: 1.6; }
    .pill { display: inline-block; background: rgba(91,94,244,0.08); border: 1px solid rgba(91,94,244,0.2); border-radius: 999px; padding: 4px 14px; font-size: 12px; font-weight: 700; color: #5b5ef4; margin-bottom: 20px; }
    .feature { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 10px; font-size: 14px; color: #475569; }
    .feature .icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
    .highlight { background: rgba(91,94,244,0.06); border: 1px solid rgba(91,94,244,0.15); border-radius: 10px; padding: 16px 18px; margin: 16px 0; }
    footer { text-align: center; margin-top: 32px; font-size: 12px; color: #94a3b8; line-height: 1.8; }
    footer a { color: #94a3b8; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="logo">QuietKeep <span>by Pranix AI Labs</span></div>
    <div class="card">
      ${content}
    </div>
    <footer>
      © ${new Date().getFullYear()} Pranix AI Labs Private Limited · Made in India 🇮🇳<br/>
      <a href="https://quietkeep.com">quietkeep.com</a> · 
      <a href="https://quietkeep.com/settings">Manage notifications</a> · 
      <a href="https://quietkeep.com/settings">Unsubscribe</a>
    </footer>
  </div>
</body>
</html>`;
}

const TEMPLATES = {
  welcome: ({ name }) => ({
    subject: `Welcome to QuietKeep, ${name || 'there'} 👋`,
    html: baseLayout(`
      <div class="pill">🎉 Welcome aboard</div>
      <h1>You're in, ${name || 'there'}!</h1>
      <p>QuietKeep is your private, voice-first life OS — keeps, reminders, family, finance, documents and more.</p>
      <a href="https://quietkeep.com/dashboard" class="btn">Open your Dashboard →</a>
      <div class="divider"></div>
      <p style="font-size:14px;font-weight:700;color:#0f172a;margin-bottom:14px;">Here's what you can do right now:</p>
      <div class="feature"><span class="icon">🎙️</span><span><strong>Voice keeps</strong> — Say it once, stored instantly. Tap the mic on Dashboard.</span></div>
      <div class="feature"><span class="icon">⏰</span><span><strong>Smart reminders</strong> — Natural language. "Call mom on Sunday" just works.</span></div>
      <div class="feature"><span class="icon">🛡️</span><span><strong>Warranty Wallet</strong> — Track your products. Send an invoice photo on WhatsApp to auto-add.</span></div>
      <div class="feature"><span class="icon">📅</span><span><strong>Daily Brief</strong> — Your personalised morning summary with Panchangam, weather, and reminders.</span></div>
      <div class="highlight">
        <strong style="color:#5b5ef4;">🎁 Share &amp; earn 30 days Premium free</strong><br/>
        <span style="font-size:13px;color:#475569;">Share your referral link from Dashboard → Settings. When a friend activates, you both get Premium for 30 days.</span>
      </div>
      <div class="small">Questions? Reply to this email or write to hello@quietkeep.com</div>
    `),
  }),

  referral_reward: ({ name, reward_days, code }) => ({
    subject: `🎁 You just earned ${reward_days} days of Premium!`,
    html: baseLayout(`
      <div class="pill">🎁 Referral reward</div>
      <h1>${reward_days} days Premium — unlocked!</h1>
      <p>Someone just signed up using your referral code <strong style="font-family:monospace;color:#5b5ef4;">${code}</strong>. As a thank you, we've added <strong>${reward_days} days of QuietKeep Premium</strong> to your account.</p>
      <div class="highlight">
        <strong style="color:#5b5ef4;">What you've unlocked:</strong><br/>
        <span style="font-size:13px;color:#475569;">Unlimited Warranty Wallet · WhatsApp invoice OCR · Lifecycle analytics · Unlimited AI Assist · Memory Vault (5 GB)</span>
      </div>
      <a href="https://quietkeep.com/dashboard" class="btn">Open QuietKeep →</a>
      <p class="small">Keep sharing your link to earn more days. Your rewards stack — no limit.</p>
    `),
  }),

  weekly_digest: ({ name, keeps_count, reminders_due, products_expiring, brief_url }) => ({
    subject: `Your QuietKeep week — ${keeps_count} keeps, ${reminders_due} reminders due`,
    html: baseLayout(`
      <div class="pill">📊 Weekly Digest</div>
      <h1>Your week with QuietKeep</h1>
      <p>Hi ${name || 'there'}, here's a snapshot of what's happening in your QuietKeep.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:20px 0;">
        <div class="highlight" style="text-align:center;">
          <div style="font-size:32px;font-weight:800;color:#5b5ef4;">${keeps_count || 0}</div>
          <div style="font-size:12px;color:#64748b;">Open keeps</div>
        </div>
        <div class="highlight" style="text-align:center;">
          <div style="font-size:32px;font-weight:800;color:#d97706;">${reminders_due || 0}</div>
          <div style="font-size:12px;color:#64748b;">Reminders due</div>
        </div>
      </div>
      ${products_expiring > 0 ? `<p>⚠️ <strong>${products_expiring} product${products_expiring > 1 ? 's' : ''}</strong> in your Warranty Wallet ${products_expiring > 1 ? 'have warranties' : 'has a warranty'} expiring in the next 30 days.</p>` : ''}
      ${brief_url ? `<a href="${brief_url}" class="btn">Read your Daily Brief →</a>` : '<a href="https://quietkeep.com/daily-brief" class="btn">Open Daily Brief →</a>'}
      <div class="small" style="margin-top:20px;">Sent every Sunday · <a href="https://quietkeep.com/settings">Change frequency</a></div>
    `),
  }),

  invoice: ({ name, product_name, purchase_price, warranty_expiry, cost_per_day }) => ({
    subject: `✅ ${product_name} added to your Warranty Wallet`,
    html: baseLayout(`
      <div class="pill">🛡️ Warranty Wallet</div>
      <h1>Invoice scanned!</h1>
      <p>We've added <strong>${product_name}</strong> to your Warranty Wallet from your WhatsApp invoice photo.</p>
      <div class="highlight">
        <div class="feature"><span class="icon">💰</span><span>Purchase price: <strong>₹${purchase_price || '—'}</strong></span></div>
        <div class="feature"><span class="icon">🛡️</span><span>Warranty until: <strong>${warranty_expiry || 'Not found'}</strong></span></div>
        ${cost_per_day ? `<div class="feature"><span class="icon">📅</span><span>Cost per day: <strong>₹${cost_per_day}</strong></span></div>` : ''}
      </div>
      <a href="https://quietkeep.com/warranty" class="btn">View Warranty Wallet →</a>
      <p class="small">Tap "Get Replacement Advice" on your product card to see AI recommendations on the best time to replace it.</p>
    `),
  }),
};

// ── Send helper ─────────────────────────────────────────────────────────────

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY not set — email not sent');
    return { skipped: true };
  }
  const res = await fetch(RESEND_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ from: FROM, reply_to: REPLY_TO, to, subject, html }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Resend error');
  return data;
}

// ── API route ────────────────────────────────────────────────────────────────

export async function POST(req) {
  // Only callable from server-side (Razorpay webhook, Supabase triggers, etc.)
  const authHeader = req.headers.get('Authorization');
  const validKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.EMAIL_API_KEY;
  if (!authHeader || !authHeader.includes(validKey?.slice(-10) || 'NOPE')) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { template, to, data: tplData } = await req.json();
    if (!template || !to) return Response.json({ error: 'template and to required' }, { status: 400 });
    if (!TEMPLATES[template]) return Response.json({ error: `Unknown template: ${template}` }, { status: 400 });

    const { subject, html } = TEMPLATES[template](tplData || {});
    const result = await sendEmail({ to, subject, html });
    return Response.json({ success: true, ...result });
  } catch (e) {
    console.error('[email route]', e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

// GET — preview a template (dev only)
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const template = searchParams.get('t') || 'welcome';
  const tpl = TEMPLATES[template];
  if (!tpl) return new Response('Template not found', { status: 404 });
  const { html } = tpl({ name: 'Prashanth', reward_days: 30, code: 'PRASHANTH1234', keeps_count: 12, reminders_due: 3, products_expiring: 2, product_name: 'Samsung TV 55"', purchase_price: 45000, warranty_expiry: '2026-03-15', cost_per_day: '12.33' });
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
}
