'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { GoogleLogin, GoogleOAuthProvider, type CredentialResponse } from '@react-oauth/google';
import { Activity, Loader2, LogIn, ShieldCheck } from 'lucide-react';
import { api, type AuthUser } from '@/lib/api';
import { AUTH_TOKEN_EVENT, clearAuthToken, getAuthToken, setAuthToken } from '@/lib/auth-token';
import { Card } from './ui/card';

interface AuthContextValue {
  user: AuthUser;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  if (!GOOGLE_CLIENT_ID) {
    return <AuthShell mode="missing-config" />;
  }

  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <AuthSession>{children}</AuthSession>
    </GoogleOAuthProvider>
  );
}

function AuthSession({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState('');

  const loadUser = useCallback(async () => {
    const token = getAuthToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      const res = await api.me();
      setUser(res.data);
      setError('');
    } catch {
      clearAuthToken();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUser();
  }, [loadUser]);

  useEffect(() => {
    const sync = () => {
      if (!getAuthToken()) setUser(null);
    };
    window.addEventListener(AUTH_TOKEN_EVENT, sync);
    return () => window.removeEventListener(AUTH_TOKEN_EVENT, sync);
  }, []);

  const signOut = useCallback(() => {
    void api.logout().catch(() => undefined);
    clearAuthToken();
    setUser(null);
  }, []);

  const handleGoogleSuccess = async (response: CredentialResponse) => {
    if (!response.credential) {
      setError('Google did not return a credential. Try again.');
      return;
    }

    setSigningIn(true);
    setError('');
    try {
      const res = await api.loginWithGoogle(response.credential);
      setAuthToken(res.data.token);
      setUser(res.data.user);
    } catch (err) {
      setError((err as Error).message || 'Google sign-in failed');
      clearAuthToken();
      setUser(null);
    } finally {
      setSigningIn(false);
    }
  };

  const value = useMemo<AuthContextValue | null>(() => (user ? { user, signOut } : null), [signOut, user]);

  if (loading) return <AuthShell mode="loading" />;

  if (!user || !value) {
    return (
      <AuthShell
        mode="login"
        error={error}
        signingIn={signingIn}
        onGoogleSuccess={handleGoogleSuccess}
        onGoogleError={() => setError('Google sign-in was cancelled or failed.')}
      />
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function AuthShell({
  mode,
  error,
  signingIn,
  onGoogleSuccess,
  onGoogleError,
}: {
  mode: 'login' | 'loading' | 'missing-config';
  error?: string;
  signingIn?: boolean;
  onGoogleSuccess?: (response: CredentialResponse) => void;
  onGoogleError?: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8">
      <Card className="w-full max-w-md overflow-hidden p-0">
        <div className="border-b border-white/[0.06] px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-400/10">
              <Activity className="h-5 w-5 text-emerald-300" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">TradePing</h1>
              <p className="text-xs text-white/45">Google sign-in required</p>
            </div>
          </div>
        </div>

        <div className="grid gap-5 px-6 py-6">
          <div className="flex items-start gap-3 rounded-lg border border-white/[0.07] bg-white/[0.03] p-4">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
            <div>
              <div className="text-sm font-semibold text-white">Protected system access</div>
              <p className="mt-1 text-sm leading-6 text-white/50">
                Sign in with a verified Google account before opening market data, alerts, settings, or database tools.
              </p>
            </div>
          </div>

          {mode === 'missing-config' ? (
            <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">
              Add <span className="font-mono">NEXT_PUBLIC_GOOGLE_CLIENT_ID</span> to the web environment, then rebuild
              the app.
            </div>
          ) : mode === 'loading' ? (
            <div className="flex items-center justify-center gap-2 py-3 text-sm text-white/55">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Checking session...
            </div>
          ) : (
            <div className="grid gap-3">
              <div className="flex min-h-11 justify-center">
                {signingIn ? (
                  <div className="flex items-center gap-2 text-sm text-white/55">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Signing in...
                  </div>
                ) : (
                  <GoogleLogin
                    onSuccess={(response) => onGoogleSuccess?.(response)}
                    onError={() => onGoogleError?.()}
                    useOneTap
                    text="signin_with"
                    shape="rectangular"
                  />
                )}
              </div>
              {error && (
                <div className="rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-100">
                  {error}
                </div>
              )}
              <div className="flex items-center justify-center gap-2 text-xs text-white/35">
                <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
                Google OAuth only
              </div>
            </div>
          )}
        </div>
      </Card>
    </main>
  );
}
