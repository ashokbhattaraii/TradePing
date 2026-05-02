'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface PollState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  refetch: () => Promise<void>;
}

/**
 * Polls `fetcher` every `intervalMs` ms.
 * On consecutive failures the interval is exponentially backed off (capped at 60s)
 * so a downed backend does not flood the network.
 */
export function usePoll<T>(fetcher: () => Promise<T>, intervalMs: number): PollState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const failuresRef = useRef(0);

  const run = useCallback(async () => {
    try {
      const result = await fetcherRef.current();
      setData(result);
      setError(null);
      failuresRef.current = 0;
    } catch (err) {
      failuresRef.current += 1;
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      if (cancelled) return;
      await run();
      if (cancelled) return;
      const backoff = Math.min(60_000, intervalMs * Math.pow(2, failuresRef.current));
      const delay = failuresRef.current === 0 ? intervalMs : backoff;
      timer = setTimeout(tick, delay);
    };
    void tick();

    return () => {
      cancelled = true;
      clearTimeout(timer!);
    };
  }, [intervalMs, run]);

  return { data, error, loading, refetch: run };
}
