// tests/mock-supabase.mjs
export const mockDb = {
  tables: {
    business_workspaces: [],
    business_members: [],
    business_customer_opt_outs: [],
    business_customers: [],
    business_approvals: [],
    business_orders: [],
    business_ledger: [],
    business_invoices: [],
    business_promo_log: [],
    business_dunning_log: [],
    business_activity_log: [],
    whatsapp_sessions: [],
    user_settings: [],
  },
  mockUser: { id: 'u1', email: 'owner@example.com' },
  failInserts: new Set(),
  reset() {
    for (const k of Object.keys(this.tables)) this.tables[k] = [];
    this.mockUser = { id: 'u1', email: 'owner@example.com' };
    this.failInserts.clear();
  }
};

function createQueryBuilder(table) {
  let filters = [];
  let isSingle = false;
  let isMaybeSingle = false;
  let countMode = false;
  let headMode = false;
  let insertData = null;
  let updateData = null;
  let isUpsert = false;
  let upsertOpts = {};
  let isDelete = false;
  let orderCol = null;
  let orderAsc = true;

  const builder = {
    select(cols, opts = {}) {
      if (opts.count) countMode = true;
      if (opts.head) headMode = true;
      return builder;
    },
    insert(rows) {
      insertData = Array.isArray(rows) ? rows : [rows];
      isUpsert = false;
      return builder;
    },
    update(patch) {
      updateData = patch;
      return builder;
    },
    upsert(rows, opts = {}) {
      insertData = Array.isArray(rows) ? rows : [rows];
      isUpsert = true;
      upsertOpts = opts;
      return builder;
    },
    delete() {
      isDelete = true;
      return builder;
    },
    eq(col, val) { filters.push(r => r[col] === val); return builder; },
    neq(col, val) { filters.push(r => r[col] !== val); return builder; },
    gte(col, val) { filters.push(r => r[col] !== undefined && r[col] >= val); return builder; },
    lte(col, val) { filters.push(r => r[col] !== undefined && r[col] <= val); return builder; },
    gt(col, val) { filters.push(r => r[col] !== undefined && r[col] > val); return builder; },
    lt(col, val) { filters.push(r => r[col] !== undefined && r[col] < val); return builder; },
    in(col, vals) { filters.push(r => vals.includes(r[col])); return builder; },
    order(col, opts = {}) { orderCol = col; orderAsc = opts.ascending !== false; return builder; },
    limit(n) { return builder; },
    range() { return builder; },
    single() { isSingle = true; return builder; },
    maybeSingle() { isMaybeSingle = true; return builder; },
    then(resolve, reject) {
      return this.execute().then(resolve, reject);
    },
    async execute() {
      if (!mockDb.tables[table]) mockDb.tables[table] = [];
      const tbl = mockDb.tables[table];

      if (insertData) {
        if (mockDb.failInserts.has(table)) {
          return { data: null, error: { message: `RLS error: no INSERT policy on ${table}` } };
        }
        if (isUpsert && upsertOpts.onConflict) {
          const conflictKeys = upsertOpts.onConflict.split(',').map(s => s.trim());
          const results = [];
          for (const row of insertData) {
            const existingIdx = tbl.findIndex(r => conflictKeys.every(k => r[k] === row[k]));
            if (existingIdx >= 0) {
              Object.assign(tbl[existingIdx], row);
              results.push(tbl[existingIdx]);
            } else {
              const created = {
                id: row.id || `gen_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                created_at: new Date().toISOString(),
                ...row
              };
              tbl.push(created);
              results.push(created);
            }
          }
          return { data: isSingle ? results[0] : results, error: null };
        } else {
          const created = insertData.map((row, idx) => ({
            id: row.id || `gen_${Date.now()}_${idx}`,
            created_at: new Date().toISOString(),
            ...row
          }));
          tbl.push(...created);
          const ret = isSingle ? created[0] : created;
          return { data: ret, error: null };
        }
      }

      if (updateData) {
        let matched = tbl.filter(r => filters.every(f => f(r)));
        matched.forEach(r => Object.assign(r, updateData));
        return { data: matched, error: null };
      }

      if (isDelete) {
        const remaining = tbl.filter(r => !filters.every(f => f(r)));
        mockDb.tables[table] = remaining;
        return { data: null, error: null };
      }

      // SELECT
      let rows = tbl.filter(r => filters.every(f => f(r)));
      if (orderCol) {
        rows.sort((a, b) => {
          if (a[orderCol] < b[orderCol]) return orderAsc ? -1 : 1;
          if (a[orderCol] > b[orderCol]) return orderAsc ? 1 : -1;
          return 0;
        });
      }
      const count = rows.length;
      if (headMode) {
        return { data: null, error: null, count };
      }
      if (isSingle) {
        if (rows.length === 0) return { data: null, error: { code: 'PGRST116', message: 'Row not found' }, count };
        return { data: rows[0], error: null, count };
      }
      if (isMaybeSingle) {
        return { data: rows[0] || null, error: null, count };
      }
      return { data: rows, error: null, count };
    }
  };
  return builder;
}

export function createClient(url, key) {
  return {
    from(table) {
      return createQueryBuilder(table);
    },
    rpc(fnName, args) {
      if (fnName === 'check_biz_permission') {
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    auth: {
      async getUser() {
        return { data: { user: mockDb.mockUser }, error: null };
      }
    }
  };
}

export async function createSupabaseServerClient() {
  return createClient('mock', 'mock');
}