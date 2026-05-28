'use client';
/**
 * src/lib/context/auth.jsx
 *
 * BLOCK 3: Central AuthContext
 * SPRINT 2 ADDITION: Wire keepsStore.setTokenProvider(refreshToken)
 * so the outbox can refresh tokens automatically before retrying writes.
 */

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

// keepsStore import is dynamic to avoid SSR issues (IndexedDB is browser-only).
// setTokenProvider is called once after first session is resolved.
let _storeWired = false;

const AuthContext = createContext({
  user:        null,
  session:     null,
  accessToken: '',
  loading:     true,
  signOut:     async () => {},
  refreshToken: async () => '',
});

export function AuthProvider({ children }) {
  const [user,        setUser]        = useState(null);
  const [session,     setSession]     = useState(null);
  const [accessToken, setAccessToken] = useState('');
  const [loading,     setLoading]     = useState(true);

  // On mount: get initial session
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      setAccessToken(s?.access_token ?? '');
      setLoading(false);

      // Wire keepsStore token provider once we have a session.
      // Dynamic import avoids SSR crash (IndexedDB not available server-side).
      if (s?.access_token && !_storeWired) {
        _storeWired = true;
        import('@/lib/keeps/store').then(({ keepsStore }) => {
          keepsStore.setTokenProvider(async () => {
            const { data: { session: fresh } } = await supabase.auth.getSession();
            return fresh?.access_token ?? null;
          });
          // Flush any pending outbox rows from a previous session.
          keepsStore.flush().catch(() => {});
        }).catch(() => {});
      }
    });

    // Subscribe to all auth state changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, s) => {
        setSession(s);
        setUser(s?.user ?? null);
        setAccessToken(s?.access_token ?? '');
        if (loading) setLoading(false);

        // On token refresh: flush outbox immediately — pending writes may have
        // failed with 401 and are waiting for a fresh token.
        if (s?.access_token) {
          import('@/lib/keeps/store').then(({ keepsStore }) => {
            keepsStore.flush().catch(() => {});
          }).catch(() => {});
        }

        // On sign-out: clear outbox (no cross-user data leakage).
        if (!s) {
          import('@/lib/keeps/store').then(({ keepsStore }) => {
            keepsStore.clear().catch(() => {});
          }).catch(() => {});
          _storeWired = false;
        }
      }
    );

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  // Force a fresh token — use before critical writes (voice capture, payment)
  const refreshToken = useCallback(async () => {
    const { data: { session: s } } = await supabase.auth.getSession();
    if (s?.access_token && s.access_token !== accessToken) {
      setSession(s);
      setAccessToken(s.access_token);
      return s.access_token;
    }
    return accessToken;
  }, [accessToken]);

  return (
    <AuthContext.Provider value={{ user, session, accessToken, loading, signOut, refreshToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
