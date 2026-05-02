'use client';

import { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import type { CrawlerLog, LogLevel } from '@tradeping/types';
import { Badge } from './ui/badge';
import { formatTime, cn } from '@/lib/utils';

const LEVEL_META: Record<
  LogLevel,
  { icon: typeof Info; color: string; bg: string; tone: 'info' | 'success' | 'warn' | 'danger' }
> = {
  INFO: { icon: Info, color: 'text-sky-300', bg: 'bg-sky-500/10', tone: 'info' },
  SUCCESS: { icon: CheckCircle2, color: 'text-emerald-300', bg: 'bg-emerald-500/10', tone: 'success' },
  WARN: { icon: TriangleAlert, color: 'text-amber-300', bg: 'bg-amber-500/10', tone: 'warn' },
  ERROR: { icon: AlertTriangle, color: 'text-red-300', bg: 'bg-red-500/10', tone: 'danger' },
};

export function LogsPanel({ logs, loading }: { logs: CrawlerLog[]; loading: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [level, setLevel] = useState<LogLevel | 'ALL'>('ALL');
  const [query, setQuery] = useState('');

  const counts = useMemo(
    () =>
      logs.reduce(
        (acc, l) => { acc[l.level]++; return acc; },
        { INFO: 0, SUCCESS: 0, WARN: 0, ERROR: 0 } as Record<LogLevel, number>,
      ),
    [logs],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((l) => {
      if (level !== 'ALL' && l.level !== level) return false;
      if (q) return l.message.toLowerCase().includes(q) || l.level.toLowerCase().includes(q);
      return true;
    });
  }, [logs, level, query]);

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-zinc-950/60 shadow-2xl shadow-black/30">
      {/* Stat bar */}
      <div className="grid grid-cols-4 divide-x divide-white/[0.06] border-b border-white/[0.06]">
        {(Object.keys(LEVEL_META) as LogLevel[]).map((key) => {
          const { icon: Icon, color, bg } = LEVEL_META[key];
          const active = level === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setLevel(active ? 'ALL' : key)}
              className={cn(
                'group flex flex-col items-center gap-1.5 px-4 py-4 transition-colors focus-visible:outline-none focus-visible:ring-inset focus-visible:ring-1 focus-visible:ring-white/30',
                active ? 'bg-white/[0.05]' : 'hover:bg-white/[0.03]',
              )}
            >
              <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', bg, active ? 'opacity-100' : 'opacity-60 group-hover:opacity-100')}>
                <Icon className={cn('h-4 w-4', color)} aria-hidden />
              </div>
              <span className="font-mono text-xl font-bold tabular-nums text-white">{counts[key]}</span>
              <span className={cn('text-[10px] font-semibold uppercase tracking-widest', active ? color : 'text-white/35')}>{key}</span>
            </button>
          );
        })}
      </div>

      {/* Search bar */}
      <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-2.5">
        <svg className="h-4 w-4 shrink-0 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input
          type="search"
          autoComplete="off"
          placeholder="Filter events…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder-white/25 focus:outline-none"
        />
        {query && (
          <button type="button" onClick={() => setQuery('')} className="text-white/30 transition-colors hover:text-white/60">
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          <span className="text-[11px] text-white/35">live</span>
        </div>
        <span className="font-mono text-[11px] tabular-nums text-white/25">{filtered.length}/{logs.length}</span>
      </div>

      {/* Table */}
      <div ref={scrollRef} className="h-[480px] overflow-y-auto overscroll-contain">
        {loading && logs.length === 0 ? (
          <div className="space-y-px p-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className={cn('h-10 animate-pulse rounded bg-white/[0.03]', i % 3 === 0 && 'opacity-50')} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-white/25">
            {logs.length === 0 ? 'Awaiting first crawler cycle…' : 'No events match the filter.'}
          </div>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 z-10 bg-zinc-950/90 backdrop-blur-sm">
              <tr className="border-b border-white/[0.05]">
                <th className="w-8 px-3 py-2" />
                <th className="w-[82px] px-3 py-2 text-left font-mono text-[10px] font-semibold uppercase tracking-widest text-white/30">Time</th>
                <th className="w-[78px] px-3 py-2 text-left font-mono text-[10px] font-semibold uppercase tracking-widest text-white/30">Level</th>
                <th className="px-3 py-2 text-left font-mono text-[10px] font-semibold uppercase tracking-widest text-white/30">Event</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              <AnimatePresence initial={false}>
                {filtered.map((log, idx) => {
                  const { icon: Icon, color, tone } = LEVEL_META[log.level];
                  return (
                    <motion.tr
                      key={log.id}
                      layout
                      initial={idx === 0 ? { opacity: 0, backgroundColor: 'rgba(255,255,255,0.04)' } : false}
                      animate={{ opacity: 1, backgroundColor: 'rgba(0,0,0,0)' }}
                      transition={{ duration: 0.4 }}
                      className={cn(
                        'group transition-colors hover:bg-white/[0.025]',
                        log.level === 'ERROR' && 'bg-red-500/[0.04] hover:bg-red-500/[0.07]',
                        log.level === 'WARN' && 'bg-amber-500/[0.02] hover:bg-amber-500/[0.05]',
                      )}
                    >
                      <td className="py-2.5 pl-3 pr-0">
                        <Icon className={cn('h-3.5 w-3.5', color)} aria-hidden />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] tabular-nums text-white/30">
                        {formatTime(log.timestamp)}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge tone={tone} className="text-[9px] font-semibold">{log.level}</Badge>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs leading-relaxed text-white/75">
                        {log.message}
                      </td>
                    </motion.tr>
                  );
                })}
              </AnimatePresence>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
