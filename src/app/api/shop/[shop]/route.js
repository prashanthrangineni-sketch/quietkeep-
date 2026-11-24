// src/app/api/shop/[shop]/route.js
// ─────────────────────────────────────────────────────────────────────────────
// Public shop API: returns public shop details and live price list (public items only).
// No authentication required. Does not leak private costs, margins, or supplier info.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic';
import { createWriteClient } from '@/lib/supabase-bearer';

export async function GET(req, { params }) {
  try {
    const { shop: shopParam } = await params;
    if (!shopParam) {
      return Response.json({ error: 'Shop identifier required' }, { status: 400 });
    }

    const db = createWriteClient();
    const cleanParam = decodeURIComponent(shopParam).trim();

    // 1. Find the workspace by id, slug, or upi_id
    let ws = null;

    // Check if UUID
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanParam);
    if (isUuid) {
      const { data } = await db
        .from('business_workspaces')
        .select('id, name, business_type, address, phone, upi_id, logo_url, slug')
        .eq('id', cleanParam)
        .maybeSingle();
      ws = data;
    }

    // If not found by UUID, try slug or upi_id
    if (!ws) {
      const { data } = await db
        .from('business_workspaces')
        .select('id, name, business_type, address, phone, upi_id, logo_url, slug')
        .or(`slug.eq.${cleanParam},upi_id.ilike.${cleanParam}`)
        .maybeSingle();
      ws = data;
    }

    if (!ws) {
      return Response.json({ error: 'Shop not found' }, { status: 404 });
    }

    // 2. Load public inventory items only (is_public = true)
    // Never expose purchase_price, supplier info, or internal margins
    const { data: rawItems, error: itemsErr } = await db
      .from('inventory_items')
      .select('id, name, sku, barcode, category, selling_price, current_stock, is_public, is_made_on_spot, unit, image_url')
      .eq('workspace_id', ws.id)
      .eq('is_public', true);

    if (itemsErr) {
      console.error('[API /api/shop/[shop]] Items query error:', itemsErr.message);
      return Response.json({ error: 'Failed to load items' }, { status: 500 });
    }

    const items = (rawItems || []).map(item => ({
      id: item.id,
      name: item.name,
      sku: item.sku || null,
      barcode: item.barcode || null,
      category: item.category || 'General',
      selling_price: Number(item.selling_price || 0),
      current_stock: Number(item.current_stock || 0),
      is_made_on_spot: Boolean(item.is_made_on_spot),
      unit: item.unit || 'pcs',
      image_url: item.image_url || null,
      in_stock: Boolean(item.is_made_on_spot || Number(item.current_stock || 0) > 0),
    }));

    return Response.json({
      shop: {
        id: ws.id,
        name: ws.name,
        business_type: ws.business_type,
        address: ws.address,
        phone: ws.phone,
        upi_id: ws.upi_id,
        logo_url: ws.logo_url,
        slug: ws.slug || null,
      },
      items,
    });
  } catch (err) {
    console.error('[API /api/shop/[shop]] Error:', err.message);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
