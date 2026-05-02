'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { BellOff, CheckCircle2, Equal, Target, Trash2, TrendingDown, TrendingUp } from 'lucide-react';
import type { StockAlert, AlertCondition, AlertPriority } from '@tradeping/types';
import type { PriceSummary } from '@/lib/api';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { useToast } from './ui/toast';
import { api } from '@/lib/api';
import { formatRelative } from '@/lib/utils';
import { cn } from '@/lib/utils';

const COND_META: Record<AlertCondition, { icon: React.ElementType; label: string; color: string; bg: string; border: string }> = {
  ABOVE: { icon: TrendingUp, label: 'above', color: 'text-emerald-300', bg: 'bg-emerald-400/10', border: 'border-emerald-400/30' },
  BELOW: { icon: TrendingDown, label: 'below', color: 'text-red-300', bg: 'bg-red-400/10', border: 'border-red-400/30' },
  EQUAL: { icon: Equal, label: 'equal', color: 'text-amber-300', bg: 'bg-amber-400/10', border: 'border-amber-400/30' },
};

export function AlertList({
  alerts,
  loading,
  onChanged,
  title = 'Active alerts',
  emptyCopy = 'No alerts yet. Create one to get started.',
  prices = [],
}: {
  alerts: StockAlert[];
  loading: boolean;
  onChanged: () => void;
  title?: string;
  emptyCopy?: string;
  prices?: PriceSummary[];
}) {
  const { push } = useToast();

  const handleDelete = async (id: string, symbol: string) => {
    try {
      await api.deleteAlert(id);
      push('info', `Removed alert for ${symbol}`);
      onChanged();
    } catch (err) {
      push('error', (err as Error).message);
    }
  };

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-zinc-950/60 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          <p className="text-xs text-white/40">
            {alerts.length} alert{alerts.length === 1 ? '' : 's'}
            {alerts.filter((a) => a.status === 'TRIGGERED').length > 0 && (
              <span className="ml-2 text-emerald-400">
                · {alerts.filter((a) => a.status === 'TRIGGERED').length} triggered
              </span>
            )}
          </p>
        </div>
        <Target className="h-4 w-4 text-white/20" />
      </div>

      {/* Body */}
      <div className="p-3">
        {loading && alerts.length === 0 ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl border border-white/5 bg-white/[0.02]" />
            ))}
          </div>
        ) : alerts.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-white/10 px-6 py-10 text-center">
            <BellOff className="h-6 w-6 text-white/20" />
            <p className="text-sm text-white/40">{emptyCopy}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            <AnimatePresence initial={false}>
              {alerts.map((alert) => {
                const livePrice = prices.find((p) => p.symbol === alert.symbol);
                const currentPrice = alert.lastCheckedPrice ?? livePrice?.price ?? null;
                return (
                  <AlertCard
                    key={alert.id}
                    alert={alert}
                    currentPrice={currentPrice}
                    onDelete={() => handleDelete(alert.id, alert.symbol)}
                  />
                );
              })}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </div>
  );
}

function AlertCard({
  alert,
  currentPrice,
  onDelete,
}: {
  alert: StockAlert;
  currentPrice: number | null;
  onDelete: () => void;
}) {
  const meta = COND_META[alert.condition];
  const Icon = meta.icon;
  const triggered = alert.status === 'TRIGGERED';

  const distancePct =
    currentPrice !== null && currentPrice > 0
      ? ((alert.targetPrice - currentPrice) / currentPrice) * 100
      : null;

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -12, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      className={cn(
        'group relative overflow-hidden rounded-xl border transition-all duration-300',
        triggered
          ? 'border-emerald-400/30 bg-emerald-400/[0.04]'
          : 'border-white/[0.07] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]',
      )}
    >
      {/* Triggered glow strip */}
      {triggered && (
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/60 to-transparent" />
      )}

      <div className="flex items-start gap-4 p-4">
        {/* Condition icon */}
        <div className="relative shrink-0">
          <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl border', meta.bg, meta.border)}>
            <Icon className={cn('h-4 w-4', meta.color)} />
          </div>
          {/* Status dot */}
          {triggered ? (
            <CheckCircle2 className="absolute -right-1 -top-1 h-4 w-4 text-emerald-400" />
          ) : (
            <span className="absolute -right-1 -top-1 flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
            </span>
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          {/* Row 1: symbol + status + priority */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-base font-bold text-white">{alert.symbol}</span>
            <span className={cn('text-xs', meta.color)}>{meta.label}</span>
            <span className="font-mono text-base font-bold text-white">
              Rs. {alert.targetPrice.toLocaleString('en-NP')}
            </span>
            <Badge tone={triggered ? 'success' : 'info'}>{alert.status}</Badge>
            <PriorityBadge priority={alert.priority} />
          </div>

          {/* Row 2: current price + distance */}
          {currentPrice !== null && (
            <div className="mt-1.5 flex flex-wrap items-center gap-3">
              <span className="text-xs text-white/45">
                current{' '}
                <span className="font-mono font-semibold text-white/70">
                  Rs. {currentPrice.toLocaleString('en-NP')}
                </span>
              </span>
              {distancePct !== null && !triggered && (
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold',
                    Math.abs(distancePct) < 2
                      ? 'bg-amber-400/10 text-amber-300'
                      : distancePct > 0
                      ? 'bg-emerald-400/10 text-emerald-300'
                      : 'bg-red-400/10 text-red-300',
                  )}
                >
                  {distancePct > 0 ? '+' : ''}{distancePct.toFixed(2)}% to go
                </span>
              )}
            </div>
          )}

          {/* Progress bar */}
          {currentPrice !== null && !triggered && (
            <AlertProgressBar
              current={currentPrice}
              target={alert.targetPrice}
              condition={alert.condition}
            />
          )}

          {/* Row 3: meta info */}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="text-[11px] text-white/25">
              created {formatRelative(alert.createdAt)}
            </span>
            {alert.triggeredAt && (
              <span className="text-[11px] text-emerald-400/60">
                · hit {formatRelative(alert.triggeredAt)}
              </span>
            )}
          </div>

          {/* Note */}
          {alert.note && (
            <p className="mt-1.5 text-xs italic text-white/35">&#8220;{alert.note}&#8221;</p>
          )}
        </div>

        {/* Delete */}
        <Button
          variant="danger"
          size="sm"
          onClick={onDelete}
          aria-label="Delete alert"
          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </motion.li>
  );
}

function AlertProgressBar({
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
  const nearTarget = Math.abs(cPct - tPct) < 8;

  return (
    <div className="mt-2.5 px-0.5">
      <div className="relative h-1 rounded-full bg-white/[0.06]">
        <div
          className={cn(
            'absolute h-full rounded-full transition-all duration-700',
            nearTarget
              ? 'bg-amber-500/50'
              : isUp
              ? 'bg-emerald-500/35'
              : 'bg-red-500/35',
          )}
          style={{ left: `${fillLeft}%`, width: `${fillWidth}%` }}
        />
        {/* current */}
        <div
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/50 bg-zinc-900 shadow-sm transition-all duration-700"
          style={{ left: `${cPct}%` }}
        />
        {/* target */}
        <div
          className={cn(
            'absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2',
            isUp ? 'border-emerald-400 bg-emerald-950' : 'border-red-400 bg-red-950',
          )}
          style={{ left: `${tPct}%` }}
        />
      </div>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: AlertPriority }) {
  if (priority === 'MEDIUM') return null; // medium is default — don't clutter
  const cfg =
    priority === 'HIGH'
      ? { label: 'HIGH', cls: 'bg-red-400/10 text-red-300 border-red-400/30' }
      : { label: 'LOW', cls: 'bg-sky-400/10 text-sky-300 border-sky-400/30' };
  return (
    <span className={cn('rounded-full border px-1.5 py-0.5 text-[10px] font-semibold', cfg.cls)}>
      {cfg.label}
    </span>
  );
}
