// src/app/api/warranty/route.js
// Warranty Wallet CRUD + AI replacement recommendation
// Also handles WhatsApp OCR queue processing

import { createClient } from '@supabase/supabase-js';

function authSupabase(token) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}
function serviceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function calcCostPerDay(price, purchaseDate) {
  if (!price || !purchaseDate) return null;
  const days = Math.max(1, Math.floor((Date.now() - new Date(purchaseDate)) / 86400000));
  return parseFloat((price / days).toFixed(4));
}

async function getAIRecommendation(product, anthropicKey) {
  if (!anthropicKey) return null;
  try {
    const prompt = `You are a product lifecycle advisor. Given this product:
Name: ${product.name}
Brand: ${product.brand || 'unknown'}
Category: ${product.category}
Purchase Date: ${product.purchase_date}
Purchase Price: ₹${product.purchase_price}
Warranty Expiry: ${product.warranty_expiry || 'unknown'}
Expected Lifespan: ${product.expected_lifespan_years || '?'} years
Cost Per Day: ₹${product.cost_per_day || 'unknown'}

In 2 sentences max, tell the user: (1) when to replace this product, (2) the best time of year to buy a replacement in India to save money (e.g. "Diwali sale", "Amazon Great Indian Festival", "year-end clearance"). Be specific and practical.`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await res.json();
    return data.content?.[0]?.text?.trim() || null;
  } catch { return null; }
}

export async function GET(req) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = authSupabase(token);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ products: data || [] });
}

export async function POST(req) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = authSupabase(token);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { action } = body;

  // GET AI RECOMMENDATION
  if (action === 'get_recommendation') {
    const { product_id } = body;
    const { data: product } = await supabase.from('products').select('*').eq('id', product_id).single();
    if (!product) return Response.json({ error: 'Product not found' }, { status: 404 });

    const rec = await getAIRecommendation(product, process.env.ANTHROPIC_API_KEY);
    if (rec) {
      await supabase.from('products').update({
        ai_replacement_recommendation: rec,
        ai_recommendation_updated_at: new Date().toISOString(),
      }).eq('id', product_id);
    }
    return Response.json({ recommendation: rec });
  }

  // SAVE PRODUCT
  const costPerDay = calcCostPerDay(body.purchase_price, body.purchase_date);
  const payload = {
    user_id: user.id,
    name: body.name?.trim(),
    brand: body.brand || null,
    category: body.category || 'electronics',
    purchase_date: body.purchase_date || null,
    purchase_price: body.purchase_price ? parseFloat(body.purchase_price) : null,
    warranty_expiry: body.warranty_expiry || null,
    serial_number: body.serial_number || null,
    model_number: body.model_number || null,
    store_name: body.store_name || null,
    notes: body.notes || null,
    expected_lifespan_years: body.expected_lifespan_years ? parseFloat(body.expected_lifespan_years) : null,
    cost_per_day: costPerDay,
    source: body.source || 'manual',
  };

  if (!payload.name) return Response.json({ error: 'name required' }, { status: 400 });

  let data, error;
  if (body.id) {
    ({ data, error } = await supabase.from('products').update(payload).eq('id', body.id).select().single());
  } else {
    ({ data, error } = await supabase.from('products').insert(payload).select().single());
  }

  if (error) return Response.json({ error: error.message }, { status: 500 });

  await supabase.from('audit_log').insert({
    user_id: user.id,
    action: body.id ? 'product_updated' : 'product_created',
    service: 'warranty_wallet',
    details: { name: payload.name, category: payload.category },
  });

  return Response.json({ product: data });
}

export async function DELETE(req) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = authSupabase(token);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await req.json();
  const { error } = await supabase.from('products').delete().eq('id', id).eq('user_id', user.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ deleted: true });
}
