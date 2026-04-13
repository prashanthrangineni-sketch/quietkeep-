'use client';
// src/lib/context/biz-permissions.jsx
// Business permission context — loads once on b/ layout mount.
// Usage:
//   import { useBizPermissions } from '@/lib/context/biz-permissions';
//   const { can, role, isOwner, loading } = useBizPermissions();
//   {can('ledger', 'create') && <button>New Entry</button>}

import { createContext, useContext, useState, useEffect } from 'react';
import { canDo } from '@/lib/biz-rbac';

const BizPermContext = createContext({
  permissions: {},
  role:        'staff',
  isOwner:     false,
  loading:     true,
  can:         () => false,
});

export function BizPermProvider({ children, accessToken }) {
  const [state, setState] = useState({
    permissions: {}, role: 'staff', isOwner: false, loading: true,
  });

  useEffect(() => {
    if (!accessToken) return;

    fetch('/api/business/permissions', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        setState({
          permissions: data.permissions || {},
          role:        data.role        || 'staff',
          isOwner:     data.is_owner    || false,
          loading:     false,
        });
      })
      .catch(() => setState(s => ({ ...s, loading: false })));
  }, [accessToken]);

  const can = canDo(state.permissions);

  return (
    <BizPermContext.Provider value={{ ...state, can }}>
      {children}
    </BizPermContext.Provider>
  );
}

export function useBizPermissions() {
  return useContext(BizPermContext);
}
