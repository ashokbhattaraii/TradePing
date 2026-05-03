'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { GoogleLogin, GoogleOAuthProvider, type CredentialResponse } from '@react-oauth/google';
import { Activity, BellRing, Loader2, LogIn, ShieldCheck, Sparkles, TrendingUp } from 'lucide-react';
import { api, type AuthUser } from '@/lib/api';
import { AUTH_TOKEN_EVENT, clearAuthToken, getAuthToken, setAuthToken } from '@/lib/auth-token';
import { Card } from './ui/card';
import { LoginTicker } from './login-ticker';

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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      {/* Ambient background glow */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-[-15%] h-[55rem] w-[55rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(16,185,129,0.18),transparent_70%)] blur-3xl" />
        <div className="absolute bottom-[-20%] right-[-10%] h-[40rem] w-[40rem] rounded-full bg-[radial-gradient(closest-side,rgba(59,130,246,0.16),transparent_70%)] blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
            backgroundSize: '44px 44px',
          }}
        />
      </div>

      <div className="absolute inset-x-0 top-0 z-10 overflow-hidden border-b border-white/[0.08] bg-[#0b0b0e]/90 shadow-[0_16px_50px_rgba(0,0,0,0.38)] backdrop-blur">
        <div className="flex flex-col gap-2 border-b border-white/[0.06] px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            <div>
              <div className="text-sm font-bold uppercase tracking-wide text-white">Latest 10 Stocks</div>
              <div className="text-xs text-white/45">Live NEPSE prices</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-white/40">
            <TrendingUp className="h-4 w-4 text-emerald-300/70" aria-hidden="true" />
            NEPSE
          </div>
        </div>
        <LoginTicker />
      </div>

      <div className="w-full max-w-xl animate-fade-in-slow pt-28 sm:pt-24">
        <Card className="relative mx-auto w-full overflow-hidden p-0">
          {/* Gradient top accent */}
          <div className="h-[2px] w-full bg-[linear-gradient(90deg,#10b981,#3b82f6,#10b981)] bg-[length:200%_100%] animate-gradient-shift" />

          <div className="border-b border-white/[0.06] px-6 py-6">
            <div className="flex items-center gap-3">
              <div className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-400/10 animate-glow-pulse">
                <Activity className="h-5 w-5 text-emerald-300 animate-float" aria-hidden="true" />
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-white">TradePing</h1>
                <p className="text-xs text-white/45">Real-time NEPSE alerts · Google sign-in required</p>
              </div>
            </div>
          </div>

          <div className="grid gap-5 px-6 py-6">
            {/* Feature highlights */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {[
                { icon: TrendingUp, label: 'Live prices', tint: 'text-emerald-300', bg: 'bg-emerald-400/10' },
                { icon: BellRing, label: 'Price alerts', tint: 'text-blue-300', bg: 'bg-blue-400/10' },
                { icon: Sparkles, label: 'Smart signals', tint: 'text-purple-300', bg: 'bg-purple-400/10' },
              ].map((f, i) => (
                <div
                  key={f.label}
                  className="group flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 transition-all duration-300 hover:-translate-y-0.5 hover:border-white/15 hover:bg-white/[0.05] animate-fade-in"
                  style={{ animationDelay: `${i * 100}ms`, animationFillMode: 'backwards' }}
                >
                  <span className={`flex h-7 w-7 items-center justify-center rounded-md ${f.bg}`}>
                    <f.icon className={`h-3.5 w-3.5 ${f.tint}`} aria-hidden="true" />
                  </span>
                  <span className="text-xs font-medium text-white/75">{f.label}</span>
                </div>
              ))}
            </div>

            <div className="flex items-start gap-3 rounded-lg border border-white/[0.07] bg-white/[0.03] p-4 transition-colors hover:border-white/15">
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
                    <div className="transition-transform duration-200 hover:scale-[1.02]">
                      <GoogleLogin
                        onSuccess={(response) => onGoogleSuccess?.(response)}
                        onError={() => onGoogleError?.()}
                        useOneTap
                        text="signin_with"
                        shape="rectangular"
                      />
                    </div>
                  )}
                </div>
                {error && (
                  <div className="animate-fade-in rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-100">
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

        <p className="mt-4 text-center text-[11px] text-white/30">
          Market data is informational only · Not investment advice
        </p>
      </div>
    </main>
  );
}
