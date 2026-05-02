'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api, type PricePoint, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

type Range = '1d' | '5d' | '1mo';
const RANGES: { id: Range; label: string }[] = [
  { id: '1d', label: '1D' },
  { id: '5d', label: '5D' },
  { id: '1mo', label: '1M' },
];

export function PriceChart({ symbol, currentPrice }: { symbol: string; currentPrice?: number }) {
  const [range, setRange] = useState<Range>('1d');
  const [points, setPoints] = useState<PricePoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .priceHistory(symbol, range)
      .then((res) => {
        if (cancelled) return;
        setPoints(res.data);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err instanceof ApiError && err.isOffline ? 'Backend offline' : err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, range]);

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wider text-white/40">Price history</span>
        <div className="flex gap-1 rounded-lg border border-white/10 p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRange(r.id)}
              className={cn(
                'rounded-md px-2 py-0.5 text-xs font-medium transition-colors',
                range === r.id ? 'bg-white text-black' : 'text-white/55 hover:text-white',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="relative h-32 rounded-lg border border-white/8 bg-black/20">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center text-white/40">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          </div>
        ) : error ? (
          <div className="absolute inset-0 flex items-center justify-center px-3 text-center text-xs text-white/45">
            {error}
          </div>
        ) : points && points.length >= 2 ? (
          <Sparkline points={points} currentPrice={currentPrice} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center px-3 text-center text-xs text-white/45">
            Not enough history yet — samples accumulate while the crawler runs.
          </div>
        )}
      </div>
    </div>
  );
}

function Sparkline({ points, currentPrice }: { points: PricePoint[]; currentPrice?: number }) {
  const width = 600;
  const height = 128;
  const padX = 4;
  const padY = 8;

  const prices = points.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;

  const xs = (i: number) => padX + (i / (points.length - 1)) * (width - padX * 2);
  const ys = (price: number) => height - padY - ((price - min) / range) * (height - padY * 2);

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xs(i).toFixed(1)} ${ys(p.price).toFixed(1)}`)
    .join(' ');
  const areaPath = `${path} L ${xs(points.length - 1).toFixed(1)} ${height - padY} L ${xs(0).toFixed(1)} ${height - padY} Z`;

  const last = points[points.length - 1].price;
  const first = points[0].price;
  const up = last >= first;
  const stroke = up ? '#34d399' : '#f87171';
  const fill = up ? 'rgba(52,211,153,0.16)' : 'rgba(248,113,113,0.16)';

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
      <path d={areaPath} fill={fill} />
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {currentPrice !== undefined && currentPrice >= min && currentPrice <= max && (
        <line
          x1={padX}
          x2={width - padX}
          y1={ys(currentPrice)}
          y2={ys(currentPrice)}
          stroke="rgba(255,255,255,0.2)"
          strokeDasharray="3 3"
          strokeWidth={1}
        />
      )}
      <text x={padX} y={12} fill="rgba(255,255,255,0.4)" fontSize={10} fontFamily="monospace">
        {max.toFixed(2)}
      </text>
      <text x={padX} y={height - 2} fill="rgba(255,255,255,0.4)" fontSize={10} fontFamily="monospace">
        {min.toFixed(2)}
      </text>
    </svg>
  );
}
