'use client';
/**
 * src/lib/context/auth.jsx
 *
 * BLOCK 3: Central AuthContext
 *
 * Replaces 33 independent supabase.auth.getSession() calls across the app.
 *
 * WHY:
 * - Each page calling getSession() independently creates race conditions
 *   when Supabase silently refreshes the JWT (every hour). React state lags
 *   behind — stale tokens cause 401s on voice/capture, keeps/transition, etc.
 * - 33 network calls on every cold page load.
 * - No single source of truth for the current user.
 *
 * HOW:
 * - Wraps layout.jsx children
 * - Single auth.onAuthStateChange listener updates context
 * - All pages read { user, accessToken, session, loading } from useAuth()
 * - Token is always the freshest from onAuthStateChange
 *
 * USAGE:
 *   import { useAuth } from '@/lib/context/auth'
 *   const { user, accessToken, loading } = useAuth()
 */

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

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
    });

    // Subscribe to all auth state changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, s) => {
        setSession(s);
        setUser(s?.user ?? null);
        setAccessToken(s?.access_token ?? '');
        if (loading) setLoading(false);
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
