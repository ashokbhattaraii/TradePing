'use client';

import { useEffect, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, TrendingUp } from 'lucide-react';
import { api, type PreviewPrice } from '@/lib/api';

export function LoginTicker() {
  const [prices, setPrices] = useState<PreviewPrice[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await api.pricesPreview(10);
        if (!cancelled) {
          setPrices(res.data);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    };
    void load();
    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (error || (prices && prices.length === 0)) {
    return (
      <div className="flex min-h-24 items-center gap-3 px-5 py-4 text-sm text-white/45">
        <TrendingUp className="h-5 w-5 text-emerald-300/70" aria-hidden="true" />
        Latest stock preview unavailable
      </div>
    );
  }

  if (!prices) {
    return (
      <div className="flex min-h-28 items-center gap-4 overflow-hidden px-5 py-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-20 w-52 shrink-0 animate-pulse rounded-lg bg-gradient-to-r from-white/[0.04] via-white/[0.08] to-white/[0.04] bg-[length:200%_100%]"
            style={{ animationDelay: `${i * 120}ms` }}
          />
        ))}
      </div>
    );
  }

  // Duplicate list so the marquee can loop seamlessly via -50% translate
  const loop = [...prices, ...prices];

  return (
    <div className="group relative overflow-hidden" aria-label="Latest 10 stock prices">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-[#0b0b0e] to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-[#0b0b0e] to-transparent" />
      <div className="flex w-max animate-marquee gap-4 px-5 py-4 group-hover:[animation-play-state:paused]">
        {loop.map((p, i) => {
          const up = p.change >= 0;
          return (
            <div
              key={`${p.symbol}-${i}`}
              className="grid h-24 w-56 shrink-0 content-between rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 shadow-[0_10px_28px_rgba(0,0,0,0.24)] transition-colors hover:border-white/20 hover:bg-white/[0.07]"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block font-mono text-lg font-bold leading-none tracking-wide text-white">{p.symbol}</span>
                  {p.name && p.name !== p.symbol && (
                    <span className="mt-1 block max-w-28 truncate text-xs text-white/45">{p.name}</span>
                  )}
                </span>
                <span
                  className={`inline-flex min-w-16 items-center justify-center gap-1 rounded-full px-2 py-1 font-mono text-xs font-bold ${
                    up ? 'bg-emerald-400/10 text-emerald-300' : 'bg-rose-400/10 text-rose-300'
                  }`}
                >
                  {up ? (
                    <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {up ? '+' : ''}
                  {p.changePct.toFixed(2)}%
                </span>
              </div>
              <div>
                <div className="font-mono text-2xl font-bold leading-none text-white">Rs. {p.price.toFixed(2)}</div>
                <div className={`mt-2 font-mono text-sm font-semibold ${up ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {up ? '+' : ''}
                  {p.change.toFixed(2)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
