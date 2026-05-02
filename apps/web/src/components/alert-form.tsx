'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, Equal, MessageSquare, Plus, Search, TrendingDown, TrendingUp, X } from 'lucide-react';
import { STOCK_ALIASES, STOCK_SYMBOLS } from '@tradeping/types';
import type { AlertCondition, AlertPriority, StockSymbol } from '@tradeping/types';
import type { PriceSummary } from '@/lib/api';
import { api } from '@/lib/api';
import { Button } from './ui/button';
import { useToast } from './ui/toast';
import { cn } from '@/lib/utils';

const CONDITIONS: {
  value: AlertCondition;
  label: string;
  sub: string;
  icon: React.ElementType;
  color: string;
  border: string;
  bg: string;
  glow: string;
}[] = [
  {
    value: 'ABOVE',
    label: 'Above',
    sub: 'Price rises above target',
    icon: TrendingUp,
    color: 'text-emerald-300',
    border: 'border-emerald-400/50',
    bg: 'bg-emerald-400/10',
    glow: 'shadow-[0_0_24px_rgba(52,211,153,0.18)]',
  },
  {
    value: 'EQUAL',
    label: 'Equal',
    sub: 'Price matches target exactly',
    icon: Equal,
    color: 'text-amber-300',
    border: 'border-amber-400/50',
    bg: 'bg-amber-400/10',
    glow: 'shadow-[0_0_24px_rgba(251,191,36,0.18)]',
  },
  {
    value: 'BELOW',
    label: 'Below',
    sub: 'Price drops below target',
    icon: TrendingDown,
    color: 'text-red-300',
    border: 'border-red-400/50',
    bg: 'bg-red-400/10',
    glow: 'shadow-[0_0_24px_rgba(248,113,113,0.18)]',
  },
];

export function AlertForm({
  onCreated,
  symbols = [],
  prices = [],
  defaultCondition = 'ABOVE',
  defaultPriority = 'MEDIUM',
}: {
  onCreated?: () => void;
  symbols?: string[];
  prices?: PriceSummary[];
  defaultCondition?: string;
  defaultPriority?: string;
}) {
  const { push } = useToast();
  const [allSymbols, setAllSymbols] = useState<string[]>(STOCK_SYMBOLS);
  const [symbol, setSymbol] = useState<StockSymbol>('NABIL');
  const [query, setQuery] = useState('NABIL');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [targetPrice, setTargetPrice] = useState('');
  const [condition, setCondition] = useState<AlertCondition>((defaultCondition as AlertCondition) || 'ABOVE');
  const [priority, setPriority] = useState<AlertPriority>((defaultPriority as AlertPriority) || 'MEDIUM');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .stocks()
      .then((res) => {
        if (cancelled) return;
        const merged = Array.from(
          new Set([...symbols, ...res.data, ...STOCK_SYMBOLS, ...Object.values(STOCK_ALIASES)]),
        ).sort((a, b) => a.localeCompare(b));
        setAllSymbols(merged);
      })
      .catch(() => {
        if (!cancelled) {
          setAllSymbols(
            Array.from(new Set([...symbols, ...STOCK_SYMBOLS, ...Object.values(STOCK_ALIASES)])).sort(
              (a, b) => a.localeCompare(b),
            ),
          );
        }
      });
    return () => { cancelled = true; };
  }, [symbols]);

  const livePrice = useMemo(
    () => prices.find((p) => p.symbol === (STOCK_ALIASES[symbol] ?? symbol)),
    [prices, symbol],
  );

  const numTarget = Number(targetPrice);
  const distancePct = useMemo(() => {
    if (!livePrice || !targetPrice || isNaN(numTarget) || numTarget <= 0) return null;
    return ((numTarget - livePrice.price) / livePrice.price) * 100;
  }, [livePrice, targetPrice, numTarget]);

  const filteredSymbols = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return allSymbols.slice(0, 30);
    return allSymbols.filter((s) => s.startsWith(q) || s.includes(q)).slice(0, 30);
  }, [query, allSymbols]);

  const selectSymbol = (s: string) => {
    const normalized = (STOCK_ALIASES[s] ?? s) as StockSymbol;
    setSymbol(normalized);
    setQuery(normalized);
    setDropdownOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedSymbol = (STOCK_ALIASES[symbol] ?? symbol) as StockSymbol;
    const price = Number(targetPrice);
    if (!/^[A-Z0-9]{1,12}$/.test(normalizedSymbol)) {
      push('error', 'Enter a valid NEPSE symbol, e.g. NABIL');
      return;
    }
    if (!targetPrice || isNaN(price) || price <= 0) {
      push('error', 'Enter a valid target price');
      return;
    }
    setSubmitting(true);
    try {
      await api.createAlert({
        symbol: normalizedSymbol,
        targetPrice: price,
        condition,
        priority,
        note: note.trim() || undefined,
      });
      push('success', `Alert set: ${normalizedSymbol} ${condition} Rs. ${price}`);
      setTargetPrice('');
      setNote('');
      onCreated?.();
    } catch (err) {
      push('error', (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const conditionMeta = CONDITIONS.find((c) => c.value === condition)!;

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-white/[0.08] bg-zinc-950/60 shadow-2xl"
    >
      {/* Form header */}
      <div className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-400/10">
          <Bell className="h-3.5 w-3.5 text-blue-300" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-white">Create alert</h2>
          <p className="text-xs text-white/40">Trigger a notification when price hits your target.</p>
        </div>
      </div>

      <div className="grid gap-6 p-5">
        {/* Step 1 — Symbol */}
        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-white/40">
            Symbol
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
            <input
              ref={inputRef}
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value.toUpperCase());
                setDropdownOpen(true);
              }}
              onFocus={() => setDropdownOpen(true)}
              onBlur={() => setTimeout(() => setDropdownOpen(false), 160)}
              placeholder="Search NEPSE symbol…"
              className="h-10 w-full rounded-lg border border-white/10 bg-white/5 pl-9 pr-28 text-sm font-mono font-semibold text-white placeholder:font-normal placeholder:text-white/30 transition-colors focus:border-white/30 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-white/10"
            />
            {/* Live price chip */}
            {livePrice && (
              <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                <span className="font-mono text-xs font-semibold text-white/70">
                  Rs.{livePrice.price.toLocaleString('en-NP')}
                </span>
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold',
                    livePrice.change >= 0
                      ? 'bg-emerald-400/10 text-emerald-300'
                      : 'bg-red-400/10 text-red-300',
                  )}
                >
                  {livePrice.change >= 0 ? '+' : ''}{livePrice.changePct.toFixed(2)}%
                </span>
              </div>
            )}
            {/* Dropdown */}
            <AnimatePresence>
              {dropdownOpen && filteredSymbols.length > 0 && (
                <motion.ul
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.1 }}
                  className="absolute left-0 top-full z-50 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-white/10 bg-zinc-900 shadow-2xl"
                >
                  {filteredSymbols.map((s) => {
                    const p = prices.find((pr) => pr.symbol === s);
                    return (
                      <li
                        key={s}
                        onMouseDown={() => selectSymbol(s)}
                        className={cn(
                          'flex cursor-pointer items-center justify-between px-3 py-2 text-sm transition-colors hover:bg-white/[0.06]',
                          s === symbol ? 'bg-white/[0.08] font-semibold text-white' : 'text-white/70',
                        )}
                      >
                        <span className="font-mono">{s}</span>
                        {p && (
                          <span className="font-mono text-xs text-white/45">
                            Rs. {p.price.toLocaleString('en-NP')}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </motion.ul>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Step 2 — Condition */}
        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-white/40">
            Condition
          </label>
          <div className="grid grid-cols-3 gap-2">
            {CONDITIONS.map(({ value, label, sub, icon: Icon, color, border, bg, glow }) => {
              const active = condition === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setCondition(value)}
                  className={cn(
                    'flex flex-col items-center gap-2 rounded-xl border px-3 py-3.5 text-center transition-all duration-200',
                    active
                      ? cn('border', border, bg, glow)
                      : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05]',
                  )}
                >
                  <div
                    className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-full transition-colors',
                      active ? bg : 'bg-white/5',
                    )}
                  >
                    <Icon className={cn('h-4 w-4 transition-colors', active ? color : 'text-white/30')} />
                  </div>
                  <div>
                    <div className={cn('text-sm font-semibold transition-colors', active ? 'text-white' : 'text-white/50')}>
                      {label}
                    </div>
                    <div className="mt-0.5 text-[10px] leading-tight text-white/30">{sub}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Step 3 — Target price */}
        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-white/40">
            Target price
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-white/40">
              Rs.
            </span>
            <input
              type="number"
              inputMode="decimal"
              autoComplete="off"
              placeholder={livePrice ? String(livePrice.price) : '0'}
              value={targetPrice}
              onChange={(e) => setTargetPrice(e.target.value)}
              className="h-11 w-full rounded-lg border border-white/10 bg-white/5 pl-10 pr-4 font-mono text-lg font-semibold text-white placeholder:font-normal placeholder:text-white/20 transition-colors focus:border-white/30 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-white/10"
            />
            {targetPrice && (
              <button
                type="button"
                onClick={() => setTargetPrice('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-white/30 transition-colors hover:text-white/60"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Distance indicator */}
          <AnimatePresence>
            {distancePct !== null && livePrice && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-3 flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                  <div className="flex items-center gap-2 text-xs text-white/50">
                    <span className="font-mono font-medium text-white/70">
                      Rs. {livePrice.price.toLocaleString('en-NP')}
                    </span>
                    <span>current</span>
                  </div>
                  <div
                    className={cn(
                      'rounded-full px-2.5 py-1 font-mono text-xs font-semibold',
                      distancePct > 0
                        ? 'bg-emerald-400/10 text-emerald-300'
                        : distancePct < 0
                        ? 'bg-red-400/10 text-red-300'
                        : 'bg-white/10 text-white/60',
                    )}
                  >
                    {distancePct > 0 ? '+' : ''}{distancePct.toFixed(2)}% from now
                  </div>
                  <div className="flex items-center gap-2 text-xs text-white/50">
                    <span>target</span>
                    <span className="font-mono font-medium text-white/70">
                      Rs. {numTarget.toLocaleString('en-NP')}
                    </span>
                  </div>
                </div>
                {/* Price bar */}
                <PriceBar current={livePrice.price} target={numTarget} condition={condition} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Step 4 — Priority */}
        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-white/40">
            Priority
          </label>
          <div className="flex gap-2">
            {(
              [
                { value: 'HIGH', color: 'text-red-300', border: 'border-red-400/50', bg: 'bg-red-400/10', dot: 'bg-red-400' },
                { value: 'MEDIUM', color: 'text-amber-300', border: 'border-amber-400/50', bg: 'bg-amber-400/10', dot: 'bg-amber-400' },
                { value: 'LOW', color: 'text-sky-300', border: 'border-sky-400/50', bg: 'bg-sky-400/10', dot: 'bg-sky-400' },
              ] as const
            ).map(({ value, color, border, bg, dot }) => (
              <button
                key={value}
                type="button"
                onClick={() => setPriority(value)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-semibold transition-all duration-200',
                  priority === value
                    ? cn(border, bg, color)
                    : 'border-white/[0.08] bg-white/[0.02] text-white/35 hover:bg-white/[0.05] hover:text-white/60',
                )}
              >
                <span className={cn('h-2 w-2 rounded-full', priority === value ? dot : 'bg-white/20')} />
                {value}
              </button>
            ))}
          </div>
        </div>

        {/* Step 5 — Note (optional) */}
        <div>
          <label className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/40">
            <MessageSquare className="h-3.5 w-3.5" />
            Note
            <span className="font-normal normal-case text-white/25">(optional)</span>
          </label>
          <div className="relative">
            <input
              type="text"
              maxLength={200}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Break above resistance — buy signal"
              className="h-10 w-full rounded-lg border border-white/10 bg-white/5 px-3 pr-16 text-sm text-white placeholder:text-white/20 transition-colors focus:border-white/30 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-white/10"
            />
            {note && (
              <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
                <span className="font-mono text-[10px] text-white/25">{note.length}/200</span>
              </div>
            )}
          </div>
        </div>

        {/* Submit */}
        <Button
          type="submit"
          loading={submitting}
          disabled={!targetPrice || isNaN(numTarget) || numTarget <= 0}
          className={cn(
            'w-full justify-center gap-2 transition-all',
            conditionMeta.bg,
          )}
        >
          <Plus className="h-4 w-4" />
          Set alert — {symbol} {condition} Rs. {numTarget > 0 ? numTarget.toLocaleString('en-NP') : '…'}
        </Button>
      </div>
    </form>
  );
}

function PriceBar({
  current,
  target,
  condition,
}: {
  current: number;
  target: number;
  condition: AlertCondition;
}) {
  const min = Math.min(current, target) * 0.96;
  const max = Math.max(current, target) * 1.04;
  const range = max - min || 1;
  const cPct = Math.round(((current - min) / range) * 100);
  const tPct = Math.round(((target - min) / range) * 100);
  const fillLeft = Math.min(cPct, tPct);
  const fillWidth = Math.abs(tPct - cPct);
  const isUp = condition === 'ABOVE';

  return (
    <div className="mt-2 px-1">
      <div className="relative h-1.5 rounded-full bg-white/10">
        {/* fill between current and target */}
        <div
          className={cn('absolute h-full rounded-full', isUp ? 'bg-emerald-500/40' : 'bg-red-500/40')}
          style={{ left: `${fillLeft}%`, width: `${fillWidth}%` }}
        />
        {/* current price marker */}
        <div
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/60 bg-zinc-900 shadow"
          style={{ left: `${cPct}%` }}
        />
        {/* target price marker */}
        <div
          className={cn(
            'absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow',
            isUp ? 'border-emerald-400 bg-emerald-900' : 'border-red-400 bg-red-900',
          )}
          style={{ left: `${tPct}%` }}
        />
      </div>
      <div className="mt-2 flex justify-between">
        <span className="font-mono text-[10px] text-white/35">Rs. {Math.round(min).toLocaleString('en-NP')}</span>
        <span className="font-mono text-[10px] text-white/35">Rs. {Math.round(max).toLocaleString('en-NP')}</span>
      </div>
    </div>
  );
}
