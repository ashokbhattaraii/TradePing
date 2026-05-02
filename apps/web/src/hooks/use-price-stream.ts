'use client';

import { useEffect, useRef, useState } from 'react';
import { API_BASE, api, type PriceSummary } from '@/lib/api';
import { getAuthToken } from '@/lib/auth-token';

interface State {
  data: PriceSummary[] | null;
  connected: boolean;
  error: Error | null;
}

/**
 * Subscribes to /crawler/prices/stream over SSE.
 * Falls back to polling at `pollMs` if EventSource isn't supported, the
 * connection drops, or the browser blocks reconnection.
 */
export function usePriceStream(pollMs: number): State & { refetch: () => void } {
  const [state, setState] = useState<State>({ data: null, connected: false, error: null });
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchOnce = async () => {
    try {
      const res = await api.prices();
      setState((s) => ({ ...s, data: res.data, error: null }));
    } catch (err) {
      setState((s) => ({ ...s, error: err as Error }));
    }
  };

  const startPolling = () => {
    if (pollTimerRef.current) return;
    void fetchOnce();
    pollTimerRef.current = setInterval(() => void fetchOnce(), pollMs);
  };
  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
      startPolling();
      return stopPolling;
    }

    let es: EventSource | null = null;
    let closed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 1000;

    const connect = () => {
      if (closed) return;
      const url = new URL(`${API_BASE.replace(/\/$/, '')}/crawler/prices/stream`, window.location.origin);
      const token = getAuthToken();
      if (token) url.searchParams.set('auth', token);
      es = new EventSource(url.toString());
      es.onopen = () => {
        retryDelay = 1000;
        stopPolling();
        setState((s) => ({ ...s, connected: true, error: null }));
      };
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as PriceSummary[];
          setState((s) => ({ ...s, data, error: null, connected: true }));
        } catch {
          /* ignore malformed event */
        }
      };
      es.onerror = () => {
        es?.close();
        setState((s) => ({ ...s, connected: false }));
        if (closed) return;
        startPolling();
        retryTimer = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30_000);
      };
    };

    connect();
    return () => {
      closed = true;
      es?.close();
      if (retryTimer) clearTimeout(retryTimer);
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollMs]);

  return { ...state, refetch: () => void fetchOnce() };
}
