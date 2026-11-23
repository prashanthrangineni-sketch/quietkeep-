// src/app/api/business/inventory/bulk-public/route.js
// ─────────────────────────────────────────────────────────────────────────────
// Bulk toggle public visibility on inventory items for Cart2Save
// ─────────────────────────────────────────────────────────────────────────────
export const dynamic = 'force-dynamic';
import { requireBizPermission } from '@/lib/biz-rbac';
import { createWriteClient } from '@/lib/supabase-bearer';
import { writeOutboxRow, enqueueAllPublicItems } from '@/lib/cart2save/outbox';

export async function POST(req) {
  try {
    const ctx = await requireBizPermission(req, 'inventory', 'edit');
    if (ctx.error) return ctx.error;

    const body = await req.json();
    const isPublic = body.is_public !== undefined ? Boolean(body.is_public) : true;

    const db = createWriteClient();

    // 1. Fetch current items before bulk update
    const { data: items, error: fetchErr } = await db
      .from('inventory_items')
      .select('*')
      .eq('workspace_id', ctx.workspace.id);

    if (fetchErr) {
      return Response.json({ error: fetchErr.message }, { status: 500 });
    }

    // 2. Bulk update all items in this workspace
    const { error: updateErr } = await db
      .from('inventory_items')
      .update({ is_public: isPublic, updated_at: new Date().toISOString() })
      .eq('workspace_id', ctx.workspace.id);

    if (updateErr) {
      return Response.json({ error: updateErr.message }, { status: 500 });
    }

    // 3. Enqueue outbox actions
    const { data: shop } = await db
      .from('business_workspaces')
      .select('*')
      .eq('id', ctx.workspace.id)
      .maybeSingle();

    if (isPublic) {
      // Made all public: enqueue upserts for all items
      await enqueueAllPublicItems(db, ctx.workspace.id, shop || {});
    } else {
      // Made all private: enqueue unpublish for each item that was previously public
      for (const item of items || []) {
        if (item.is_public) {
          await writeOutboxRow(db, {
            workspace_id: ctx.workspace.id,
            entity_type: 'item',
            entity_id: item.id,
            action: 'unpublish',
            payload: {
              item_id: item.id,
              unpublish: true,
              updated_time: new Date().toISOString(),
            },
          });
        }
      }
    }

    return Response.json({
      success: true,
      count: items ? items.length : 0,
      is_public: isPublic,
    });
  } catch (e) {
    console.error('[INVENTORY BULK-PUBLIC POST]', e.message);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
