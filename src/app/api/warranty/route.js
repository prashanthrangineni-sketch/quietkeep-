// src/app/api/warranty/route.js
// SPRINT 1 FIX: Unified auth + service-role write pattern.
// Removed inline authSupabase/serviceSupabase factories.
// All writes now use createWriteClient (service role). Reads use anon Bearer.

import { createBearerClient, createWriteClient, unauthorized } from '@/lib/supabase-bearer';

async function getAIRecommendation(product, anthropicKey) {
  if (!anthropicKey) return null;
  try {
    const prompt = 'You are a product lifecycle advisor. Given this product:\n' +
      'Name: ' + product.name + '\n' +
      'Brand: ' + (product.brand || 'unknown') + '\n' +
      'Category: ' + product.category + '\n' +
      'Purchase Date: ' + product.purchase_date + '\n' +
      'Purchase Price: Rs.' + product.purchase_price + '\n' +
      'Warranty Expiry: ' + (product.warranty_expiry || 'unknown') + '\n' +
      'Expected Lifespan: ' + (product.expected_lifespan_years || '?') + ' years\n' +
      'Cost Per Day: Rs.' + (product.cost_per_day || 'unknown') + '\n\n' +
      'In 2 sentences max, tell the user: (1) when to replace this product, ' +
      '(2) the best time of year to buy a replacement in India to save money ' +
      '(e.g. "Diwali sale", "Amazon Great Indian Festival", "year-end clearance"). ' +
      'Be specific and practical.';

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

function calcCostPerDay(price, purchaseDate) {
  if (!price || !purchaseDate) return null;
  const days = Math.max(1, Math.floor((Date.now() - new Date(purchaseDate)) / 86400000));
  return parseFloat((price / days).toFixed(4));
}

export async function GET(req) {
  const { supabase, user } = await createBearerClient(req);
  if (!user) return unauthorized();

  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ products: data || [] });
}

export async function POST(req) {
  const { supabase, user } = await createBearerClient(req);
  if (!user) return unauthorized();

  const body = await req.json();
  const { action } = body;
  const db = createWriteClient();

  if (action === 'get_recommendation') {
    const { product_id } = body;
    // Read via anon Bearer (SELECT safe).
    const { data: product } = await supabase
      .from('products').select('*').eq('id', product_id).single();
    if (!product) return Response.json({ error: 'Product not found' }, { status: 404 });

    const rec = await getAIRecommendation(product, process.env.ANTHROPIC_API_KEY);
    if (rec) {
      // Write via service role.
      await db.from('products').update({
        ai_replacement_recommendation: rec,
        ai_recommendation_updated_at:  new Date().toISOString(),
      }).eq('id', product_id);
    }
    return Response.json({ recommendation: rec });
  }

  const costPerDay = calcCostPerDay(body.purchase_price, body.purchase_date);
  const payload = {
    user_id:                  user.id,
    name:                     body.name?.trim(),
    brand:                    body.brand                    || null,
    category:                 body.category                 || 'electronics',
    purchase_date:            body.purchase_date            || null,
    purchase_price:           body.purchase_price ? parseFloat(body.purchase_price) : null,
    warranty_expiry:          body.warranty_expiry          || null,
    serial_number:            body.serial_number            || null,
    model_number:             body.model_number             || null,
    store_name:               body.store_name               || null,
    notes:                    body.notes                    || null,
    expected_lifespan_years:  body.expected_lifespan_years
                                ? parseFloat(body.expected_lifespan_years) : null,
    cost_per_day:             costPerDay,
    source:                   body.source                   || 'manual',
  };

  if (!payload.name) return Response.json({ error: 'name required' }, { status: 400 });

  let data, error;
  if (body.id) {
    ({ data, error } = await db.from('products')
      .update(payload).eq('id', body.id).select().single());
  } else {
    ({ data, error } = await db.from('products')
      .insert(payload).select().single());
  }

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Audit log (service role — same write client).
  await db.from('audit_log').insert({
    user_id: user.id,
    action:  body.id ? 'product_updated' : 'product_created',
    service: 'warranty_wallet',
    details: { name: payload.name, category: payload.category },
  }).catch((e) => console.error('[warranty] audit_log failed:', e.message));

  return Response.json({ product: data });
}

export async function DELETE(req) {
  const { user } = await createBearerClient(req);
  if (!user) return unauthorized();

  const { id } = await req.json();
  const db = createWriteClient();
  const { error } = await db.from('products')
    .delete().eq('id', id).eq('user_id', user.id);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ deleted: true });
}
