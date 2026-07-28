// src/app/api/finance/sms-expense/route.js
// Turn a pasted/shared payment SMS into an expense.
//   POST { text, preview? }  (Bearer auth)
//   preview:true → parse only (dry run, no write)
//   otherwise    → parse + insert a debit as an expense for the signed-in user
// Credits (money in) are parsed and returned but not logged as expenses.
export const dynamic = 'force-dynamic';
import { createBearerClient, createWriteClient, unauthorized } from '@/lib/supabase-bearer';
import { parseUpiSms } from '@/lib/upi-sms';

export async function POST(req) {
  try {
    const { user } = await createBearerClient(req);
    if (!user) return unauthorized();

    let body;
    try { body = await req.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const text = (body.text || '').trim();
    if (!text) return Response.json({ error: 'text required' }, { status: 400 });

    const parsed = parseUpiSms(text);

    if (body.preview) return Response.json({ parsed });

    if (!parsed.isPayment || !parsed.amount) {
      return Response.json({ parsed, created: null, note: 'No payment amount detected in that message.' });
    }
    if (parsed.direction === 'credit') {
      return Response.json({ parsed, created: null, note: 'That looks like money received, not an expense.' });
    }

    // Allow the client to override the parsed fields the user edited.
    const amount = Number(body.amount ?? parsed.amount);
    const category = (body.category || parsed.category || 'other').toLowerCase();
    const method = (body.payment_method || parsed.method || 'upi').toLowerCase();
    const description = (body.description || (parsed.party ? `Paid ${parsed.party}` : 'UPI payment')).slice(0, 200);
    if (!amount || amount <= 0) return Response.json({ error: 'amount must be > 0' }, { status: 400 });

    const db = createWriteClient();
    const { data, error } = await db.from('expenses').insert({
      user_id: user.id,
      amount,
      currency: 'INR',
      category,
      description,
      payment_method: method,
      voice_text: text.slice(0, 300),
      expense_date: new Date().toISOString().split('T')[0],
    }).select().single();
    if (error) return Response.json({ error: error.message }, { status: 500 });

    return Response.json({ parsed, created: data });
  } catch (e) {
    console.error('[SMS-EXPENSE]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
