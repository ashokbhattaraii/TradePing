'use client';

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowDownUp,
  BarChart3,
  Calculator,
  ExternalLink,
  Filter,
  Info,
  RefreshCw,
  Star,
  TrendingDown,
  TrendingUp,
  Minus,
  X,
} from 'lucide-react';
import type { PriceSummary, SystemSettings } from '@/lib/api';
import { getSector } from '@/lib/sectors';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { Select } from './ui/input';
import { cn } from '@/lib/utils';

function fmt(n: number) {
  return n.toLocaleString('en-NP', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtCompact(n: number) {
  return new Intl.NumberFormat('en-NP', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

type SortKey = 'symbol' | 'price' | 'changePct' | 'volume' | 'turnover';
const ALL_SECTORS = 'all';

interface SignalSettings {
  signalEngineEnabled: boolean;
  signalMomentumThresholdPct: number;
  signalLiquidityFloor: number;
  signalBreakoutRangePct: number;
  signalDipRangePct: number;
  signalAutoWatchScore: number;
}

const DEFAULT_SIGNAL_SETTINGS: SignalSettings = {
  signalEngineEnabled: true,
  signalMomentumThresholdPct: 2,
  signalLiquidityFloor: 500000,
  signalBreakoutRangePct: 80,
  signalDipRangePct: 25,
  signalAutoWatchScore: 0,
};

function chartUrl(symbol: string) {
  return `https://www.nepsealpha.com/trading/chart?symbol=${encodeURIComponent(symbol)}`;
}

function sortPrices(prices: PriceSummary[], sortKey: SortKey) {
  return [...prices].sort((a, b) => {
    if (sortKey === 'symbol') return a.symbol.localeCompare(b.symbol);
    return (b[sortKey] ?? 0) - (a[sortKey] ?? 0);
  });
}

function priceSector(price: PriceSummary): string {
  return price.sector || getSector(price.symbol);
}

function resolveSignalSettings(settings?: Partial<SystemSettings>): SignalSettings {
  return {
    signalEngineEnabled: settings?.signalEngineEnabled ?? DEFAULT_SIGNAL_SETTINGS.signalEngineEnabled,
    signalMomentumThresholdPct:
      settings?.signalMomentumThresholdPct ?? DEFAULT_SIGNAL_SETTINGS.signalMomentumThresholdPct,
    signalLiquidityFloor: settings?.signalLiquidityFloor ?? DEFAULT_SIGNAL_SETTINGS.signalLiquidityFloor,
    signalBreakoutRangePct: settings?.signalBreakoutRangePct ?? DEFAULT_SIGNAL_SETTINGS.signalBreakoutRangePct,
    signalDipRangePct: settings?.signalDipRangePct ?? DEFAULT_SIGNAL_SETTINGS.signalDipRangePct,
    signalAutoWatchScore: settings?.signalAutoWatchScore ?? DEFAULT_SIGNAL_SETTINGS.signalAutoWatchScore,
  };
}

function signalInsight(price: PriceSummary, settings?: Partial<SystemSettings>) {
  const config = resolveSignalSettings(settings);
  const range = Math.max(price.high - price.low, 0);
  const rangePosition =
    range > 0 ? Math.min(100, Math.max(0, ((price.price - price.low) / range) * 100)) : 50;
  const momentumBase = Math.max(config.signalMomentumThresholdPct, 0.1);
  const liquidityBase = Math.max(config.signalLiquidityFloor, 1);
  const momentumScore = Math.min(35, (Math.abs(price.changePct) / momentumBase) * 24);
  const liquidityScore = Math.min(25, ((price.turnover ?? 0) / liquidityBase) * 18);
  const rangeScore =
    rangePosition >= config.signalBreakoutRangePct
      ? 24
      : rangePosition <= config.signalDipRangePct
        ? 18
        : 10;
  const directionScore = price.change >= 0 ? 12 : 5;
  const score = Math.round(Math.min(100, momentumScore + liquidityScore + rangeScore + directionScore));
  const liquid = (price.turnover ?? 0) >= config.signalLiquidityFloor;
  const setup =
    !config.signalEngineEnabled
      ? 'Signal engine paused'
      : rangePosition >= config.signalBreakoutRangePct && price.changePct >= config.signalMomentumThresholdPct && liquid
        ? 'Breakout candidate'
        : rangePosition <= config.signalDipRangePct && price.changePct > -config.signalMomentumThresholdPct && liquid
          ? 'Dip watch'
          : Math.abs(price.changePct) >= config.signalMomentumThresholdPct && liquid
            ? 'Momentum watch'
            : liquid
              ? 'Liquidity watch'
              : 'Thin liquidity';
  const action =
    !config.signalEngineEnabled
      ? 'Enable Signals in settings to score this symbol.'
      : config.signalAutoWatchScore > 0 && score >= config.signalAutoWatchScore
        ? 'Meets your auto-watch threshold.'
        : score >= 70
          ? 'High-conviction watchlist candidate.'
          : score >= 45
            ? 'Track it if it matches your plan.'
            : 'Wait for a cleaner trigger.';
  return { ...config, score, setup, action, rangePosition, liquid };
}

function PriceCard({
  p,
  onSelect,
  isWatched,
  onStar,
  onUnstar,
}: {
  p: PriceSummary;
  onSelect: (price: PriceSummary) => void;
  isWatched?: boolean;
  onStar?: (symbol: string) => void;
  onUnstar?: (symbol: string) => void;
}) {
  const up = p.change > 0;
  const flat = p.change === 0;
  const sector = priceSector(p);

  return (
    <motion.div
      role="button"
      tabIndex={0}
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 340, damping: 28 }}
      onClick={() => onSelect(p)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(p); } }}
      className={cn(
        'group relative cursor-pointer overflow-hidden rounded-2xl border p-4 text-left transition-[background-color,border-color,transform] hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35',
        up
          ? 'border-emerald-500/20 bg-emerald-500/[0.04] hover:bg-emerald-500/[0.08]'
          : flat
            ? 'border-white/10 bg-white/[0.03] hover:bg-white/[0.05]'
            : 'border-red-500/20 bg-red-500/[0.04] hover:bg-red-500/[0.08]',
      )}
    >
      {/* Glow accent */}
      <div
        className={cn(
          'pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full blur-2xl',
          up ? 'bg-emerald-500/15' : flat ? 'bg-white/5' : 'bg-red-500/15',
        )}
      />

      {/* Star / watchlist button */}
      {(onStar || onUnstar) && (
        <button
          type="button"
          aria-label={isWatched ? 'Remove from watchlist' : 'Add to watchlist'}
          onClick={(e) => {
            e.stopPropagation();
            if (isWatched) onUnstar?.(p.symbol);
            else onStar?.(p.symbol);
          }}
          className={cn(
            'absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full transition-[color,opacity] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35',
            isWatched
              ? 'text-amber-400 opacity-100 hover:text-amber-300'
              : 'text-white/20 opacity-0 hover:text-white/50 group-hover:opacity-100',
          )}
        >
          <Star className={cn('h-3.5 w-3.5', isWatched && 'fill-amber-400')} />
        </button>
      )}

      <div className="relative flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 font-mono text-sm font-bold tracking-wider text-white">
              {p.symbol}
              <Info className="h-3 w-3 text-white/35" aria-hidden="true" />
            </span>
            <Badge tone={p.source === 'LIVE' ? 'success' : 'warn'} className="text-[9px]">
              {p.source}
            </Badge>
          </div>
          <div className="mt-1 max-w-[11rem] truncate text-[10px] font-medium uppercase tracking-wider text-white/35">
            {sector}
          </div>
          <motion.div
            key={p.price}
            initial={{ opacity: 0.6, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="mt-1 text-xl font-bold tabular-nums text-white"
          >
            Rs. {fmt(p.price)}
          </motion.div>
        </div>

        <div
          className={cn(
            'flex flex-col items-end gap-0.5 text-right',
            up ? 'text-emerald-300' : flat ? 'text-white/40' : 'text-red-300',
          )}
        >
          <div className="flex items-center gap-1 text-sm font-semibold tabular-nums">
            {up ? (
              <TrendingUp className="h-3.5 w-3.5" />
            ) : flat ? (
              <Minus className="h-3.5 w-3.5" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5" />
            )}
            {up ? '+' : ''}
            {p.changePct.toFixed(2)}%
          </div>
          <span className="text-[11px] tabular-nums opacity-70">
            {up ? '+' : ''}
            {fmt(p.change)}
          </span>
        </div>
      </div>

      <div className="relative mt-3 flex items-center justify-between text-[11px] text-white/40">
        <span>
          H&nbsp;
          <span className="text-white/60">{fmt(p.high)}</span>
          &nbsp;·&nbsp;L&nbsp;
          <span className="text-white/60">{fmt(p.low)}</span>
        </span>
        <span>prev {fmt(p.prevClose)}</span>
      </div>
    </motion.div>
  );
}

export function StockPrices({
  prices,
  loading,
  emptyCopy = 'No price data yet: waiting for first crawler cycle…',
  watchedSymbols,
  onStar,
  onUnstar,
  signalSettings,
}: {
  prices: PriceSummary[];
  loading: boolean;
  emptyCopy?: string;
  watchedSymbols?: Set<string>;
  onStar?: (symbol: string) => void;
  onUnstar?: (symbol: string) => void;
  signalSettings?: Partial<SystemSettings>;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('symbol');
  const [sectorFilter, setSectorFilter] = useState(ALL_SECTORS);
  const [selected, setSelected] = useState<PriceSummary | null>(null);
  const sectorOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const price of prices) {
      const sector = priceSector(price);
      counts.set(sector, (counts.get(sector) ?? 0) + 1);
    }
    return Array.from(counts, ([sector, count]) => ({ sector, count })).sort((a, b) =>
      a.sector.localeCompare(b.sector),
    );
  }, [prices]);

  const activeSectorFilter =
    sectorFilter === ALL_SECTORS || sectorOptions.some((option) => option.sector === sectorFilter)
      ? sectorFilter
      : ALL_SECTORS;

  const filteredPrices = useMemo(() => {
    if (activeSectorFilter === ALL_SECTORS) return prices;
    return prices.filter((price) => priceSector(price) === activeSectorFilter);
  }, [activeSectorFilter, prices]);

  const sorted = useMemo(() => sortPrices(filteredPrices, sortKey), [filteredPrices, sortKey]);

  const sectorGroups = useMemo(() => {
    const groups = new Map<string, PriceSummary[]>();
    for (const price of sorted) {
      const sector = priceSector(price);
      const group = groups.get(sector) ?? [];
      group.push(price);
      groups.set(sector, group);
    }
    return Array.from(groups, ([sector, sectorPrices]) => ({ sector, prices: sectorPrices })).sort((a, b) =>
      a.sector.localeCompare(b.sector),
    );
  }, [sorted]);

  const stats = useMemo(() => {
    const gainers = filteredPrices.filter((p) => p.change > 0).length;
    const losers = filteredPrices.filter((p) => p.change < 0).length;
    const live = filteredPrices.filter((p) => p.source === 'LIVE').length;
    const volume = filteredPrices.reduce((sum, p) => sum + (p.volume ?? 0), 0);
    const turnover = filteredPrices.reduce((sum, p) => sum + (p.turnover ?? 0), 0);
    return { gainers, losers, live, volume, turnover };
  }, [filteredPrices]);

  return (
    <section>
      <header className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h2 className="text-lg font-semibold text-white">Live market prices</h2>
          <p className="text-sm text-white/50">
            LTP from&nbsp;
            <a
              href="https://www.sharesansar.com/today-share-price"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 transition-colors"
            >
              ShareSansar
            </a>
            , cached 60 s
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <label className="flex items-center gap-2 text-xs text-white/45">
            <Filter className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">Filter by sector</span>
            <Select
              name="sectorFilter"
              aria-label="Filter by sector"
              value={activeSectorFilter}
              onChange={(e) => setSectorFilter(e.target.value)}
              className="h-9 w-52"
            >
              <option value={ALL_SECTORS} className="bg-zinc-900">
                All Sectors
              </option>
              {sectorOptions.map(({ sector, count }) => (
                <option key={sector} value={sector} className="bg-zinc-900">
                  {sector} ({count})
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-center gap-2 text-xs text-white/45">
            <ArrowDownUp className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">Sort prices</span>
            <Select
              name="priceSort"
              aria-label="Sort prices"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="h-9 w-40"
            >
              <option value="symbol" className="bg-zinc-900">Symbol</option>
              <option value="changePct" className="bg-zinc-900">Top Move</option>
              <option value="price" className="bg-zinc-900">Price</option>
              <option value="volume" className="bg-zinc-900">Volume</option>
              <option value="turnover" className="bg-zinc-900">Turnover</option>
            </Select>
          </label>
          {loading && prices.length > 0 && (
            <RefreshCw className="h-4 w-4 animate-spin text-white/30" aria-hidden="true" />
          )}
        </div>
      </header>

      {loading && prices.length === 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-2xl border border-white/5 bg-white/[0.02]"
            />
          ))}
        </div>
      ) : prices.length === 0 ? (
        <Card className="flex items-center justify-center py-10 text-sm text-white/40">
          {emptyCopy}
        </Card>
      ) : (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <MarketStat icon={BarChart3} label="Symbols" value={filteredPrices.length.toString()} />
            <MarketStat icon={Filter} label="Sectors" value={sectorGroups.length.toString()} />
            <MarketStat icon={TrendingUp} label="Gainers" value={stats.gainers.toString()} />
            <MarketStat icon={TrendingDown} label="Losers" value={stats.losers.toString()} />
            <MarketStat icon={RefreshCw} label="Live Quotes" value={stats.live.toString()} />
            <MarketStat icon={BarChart3} label="Turnover" value={`Rs. ${fmtCompact(stats.turnover)}`} />
          </div>

          {sectorGroups.length === 0 ? (
            <Card className="flex items-center justify-center py-10 text-sm text-white/40">
              No stocks match the selected sector.
            </Card>
          ) : (
            <div className="grid gap-5">
              {sectorGroups.map(({ sector, prices: sectorPrices }) => (
                <section key={sector} className="grid gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="truncate text-sm font-semibold text-white">{sector}</h3>
                    <Badge tone="default" className="shrink-0 text-[10px]">
                      {sectorPrices.length} {sectorPrices.length === 1 ? 'symbol' : 'symbols'}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                    <AnimatePresence initial={false}>
                      {sectorPrices.map((p) => (
                        <PriceCard
                          key={p.symbol}
                          p={p}
                          onSelect={setSelected}
                          isWatched={watchedSymbols?.has(p.symbol)}
                          onStar={onStar}
                          onUnstar={onUnstar}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                </section>
              ))}
            </div>
          )}

          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-left text-sm">
                <thead className="border-b border-white/10 bg-white/[0.03] text-xs uppercase tracking-wider text-white/40">
                  <tr>
                    <th className="px-4 py-3 font-medium">Symbol</th>
                    <th className="px-4 py-3 font-medium">Sector</th>
                    <th className="px-4 py-3 font-medium">LTP</th>
                    <th className="px-4 py-3 font-medium">Change</th>
                    <th className="px-4 py-3 font-medium">High</th>
                    <th className="px-4 py-3 font-medium">Low</th>
                    <th className="px-4 py-3 font-medium">Volume</th>
                    <th className="px-4 py-3 font-medium">Source</th>
                    <th className="px-4 py-3 font-medium">Details</th>
                    <th className="px-4 py-3 font-medium">Chart</th>
                    {(onStar || onUnstar) && <th className="px-4 py-3 font-medium">Watch</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {sorted.map((p) => (
                    <tr key={p.symbol} className="[content-visibility:auto] hover:bg-white/[0.03]">
                      <td className="px-4 py-3 font-mono font-semibold text-white">{p.symbol}</td>
                      <td className="px-4 py-3 text-white/55">{priceSector(p)}</td>
                      <td className="px-4 py-3 tabular-nums text-white">Rs. {fmt(p.price)}</td>
                      <td
                        className={cn(
                          'px-4 py-3 tabular-nums',
                          p.change > 0 ? 'text-emerald-300' : p.change < 0 ? 'text-red-300' : 'text-white/45',
                        )}
                      >
                        {p.change > 0 ? '+' : ''}
                        {p.changePct.toFixed(2)}%
                      </td>
                      <td className="px-4 py-3 tabular-nums text-white/65">{fmt(p.high)}</td>
                      <td className="px-4 py-3 tabular-nums text-white/65">{fmt(p.low)}</td>
                      <td className="px-4 py-3 tabular-nums text-white/65">{fmtCompact(p.volume ?? 0)}</td>
                      <td className="px-4 py-3">
                        <Badge tone={p.source === 'LIVE' ? 'success' : 'warn'}>{p.source}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setSelected(p)}
                          className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-medium text-white/70 transition-[background-color,border-color,color] hover:border-white/20 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
                        >
                          View Detail
                          <Info className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <a
                          href={chartUrl(p.symbol)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-medium text-white/70 transition-[background-color,border-color,color] hover:border-sky-400/30 hover:bg-sky-400/10 hover:text-sky-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
                        >
                          NepseAlpha
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                      </td>
                      {(onStar || onUnstar) && (
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            aria-label={watchedSymbols?.has(p.symbol) ? 'Remove from watchlist' : 'Add to watchlist'}
                            onClick={() => {
                              if (watchedSymbols?.has(p.symbol)) onUnstar?.(p.symbol);
                              else onStar?.(p.symbol);
                            }}
                            className={cn(
                              'flex h-8 w-8 items-center justify-center rounded-lg border transition-[background-color,border-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35',
                              watchedSymbols?.has(p.symbol)
                                ? 'border-amber-400/40 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20'
                                : 'border-white/10 bg-white/[0.03] text-white/30 hover:border-amber-400/30 hover:bg-amber-400/10 hover:text-amber-300',
                            )}
                          >
                            <Star className={cn('h-3.5 w-3.5', watchedSymbols?.has(p.symbol) && 'fill-amber-400')} />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <StockDetailDrawer
            price={selected}
            onClose={() => setSelected(null)}
            isWatched={selected ? watchedSymbols?.has(selected.symbol) : false}
            onStar={onStar}
            onUnstar={onUnstar}
            signalSettings={signalSettings}
          />
        </div>
      )}
    </section>
  );
}

function StockDetailDrawer({
  price,
  onClose,
  isWatched,
  onStar,
  onUnstar,
  signalSettings,
}: {
  price: PriceSummary | null;
  onClose: () => void;
  isWatched?: boolean;
  onStar?: (symbol: string) => void;
  onUnstar?: (symbol: string) => void;
  signalSettings?: Partial<SystemSettings>;
}) {
  if (!price) return null;

  const insight = signalInsight(price, signalSettings);
  const range = Math.max(price.high - price.low, 0);
  const rangePosition =
    range > 0 ? Math.min(100, Math.max(0, ((price.price - price.low) / range) * 100)) : 50;
  const turnoverPerShare = price.volume > 0 ? price.turnover / price.volume : price.price;
  const distanceFromPrev = price.prevClose > 0 ? ((price.price - price.prevClose) / price.prevClose) * 100 : 0;
  const sector = priceSector(price);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/55 p-3 backdrop-blur-sm sm:p-5">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close stock details"
        onClick={onClose}
      />
      <motion.aside
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="stock-detail-title"
        className="relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black/40"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-white/10 bg-zinc-950/95 p-5 backdrop-blur-xl">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id="stock-detail-title" className="font-mono text-3xl font-semibold text-white">
                {price.symbol}
              </h3>
              <Badge tone="info">{sector}</Badge>
              <Badge tone={price.source === 'LIVE' ? 'success' : 'warn'}>{price.source}</Badge>
            </div>
            <p className="mt-1 text-sm text-white/45">
              Last updated {new Date(price.timestamp).toLocaleString('en-NP')}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {(onStar || onUnstar) && (
              <button
                type="button"
                onClick={() => {
                  if (isWatched) onUnstar?.(price.symbol);
                  else onStar?.(price.symbol);
                }}
                className={cn(
                  'inline-flex h-9 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-[background-color,border-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35',
                  isWatched
                    ? 'border-amber-400/40 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20'
                    : 'border-white/10 bg-white/[0.04] text-white/70 hover:border-amber-400/35 hover:bg-amber-400/10 hover:text-amber-200',
                )}
              >
                <Star className={cn('h-3.5 w-3.5', isWatched && 'fill-amber-400')} aria-hidden="true" />
                {isWatched ? 'Watching' : 'Add to Watchlist'}
              </button>
            )}
            <button
              type="button"
              aria-label="Close stock details"
              onClick={onClose}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 text-white/60 transition-[background-color,border-color,color] hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="grid gap-5 p-5">
          <section className="grid gap-4 lg:grid-cols-[1fr_220px]">
            <Card className="p-5">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <div>
                  <div className="text-sm uppercase tracking-wider text-white/40">Last Traded Price</div>
                  <div className="mt-1 text-4xl font-semibold tabular-nums text-white">
                    Rs. {fmt(price.price)}
                  </div>
                </div>
                <div
                  className={cn(
                    'text-right font-mono text-lg font-semibold tabular-nums',
                    price.change >= 0 ? 'text-emerald-300' : 'text-red-300',
                  )}
                >
                  {price.change >= 0 ? '+' : ''}
                  {fmt(price.change)}
                  <div className="text-sm">
                    {price.change >= 0 ? '+' : ''}
                    {price.changePct.toFixed(2)}%
                  </div>
                </div>
              </div>
              <div className="mt-6">
                <div className="mb-2 flex justify-between text-xs text-white/40">
                  <span>Low Rs. {fmt(price.low)}</span>
                  <span>High Rs. {fmt(price.high)}</span>
                </div>
                <div className="h-3 rounded-full bg-white/8">
                  <div
                    className={cn(
                      'h-3 rounded-full',
                      price.change >= 0 ? 'bg-emerald-400' : 'bg-red-400',
                    )}
                    style={{ width: `${rangePosition}%` }}
                  />
                </div>
                <div className="mt-2 text-xs text-white/45">
                  Trading at {rangePosition.toFixed(0)}% of today&apos;s range.
                </div>
              </div>
            </Card>

            <Card className="grid content-between gap-4 p-5">
              <div>
                <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-sky-400/10">
                  <BarChart3 className="h-4 w-4 text-sky-300" aria-hidden="true" />
                </div>
                <div className="text-sm font-semibold text-white">NepseAlpha Chart</div>
                <p className="mt-1 text-sm text-white/45">Advanced chart opens externally.</p>
              </div>
              <a
                href={chartUrl(price.symbol)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-white px-4 text-sm font-medium text-black transition-[background-color,transform] hover:bg-white/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
              >
                Open Chart
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </a>
            </Card>
          </section>

          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <DetailMetric label="Prev Close" value={`Rs. ${fmt(price.prevClose)}`} />
            <DetailMetric label="Volume" value={fmtCompact(price.volume ?? 0)} />
            <DetailMetric label="Turnover" value={`Rs. ${fmtCompact(price.turnover ?? 0)}`} />
            <DetailMetric label="Avg Value" value={`Rs. ${fmt(turnoverPerShare)}`} />
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <div className="mb-4 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-300" aria-hidden="true" />
                <h4 className="text-sm font-semibold text-white">TradePing Edge</h4>
              </div>
              <div className="flex items-end justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-xl font-semibold text-white">{insight.setup}</div>
                  <p className="mt-1 text-sm text-white/45">{insight.action}</p>
                </div>
                <div className="text-right">
                  <div className="font-mono text-2xl font-semibold tabular-nums text-white">{insight.score}</div>
                  <div className="text-[10px] uppercase tracking-wider text-white/35">score</div>
                </div>
              </div>
              <div className="mt-4 h-2 rounded-full bg-white/8">
                <div
                  className={cn(
                    'h-2 rounded-full',
                    insight.score >= 70 ? 'bg-emerald-400' : insight.score >= 45 ? 'bg-amber-300' : 'bg-white/30',
                  )}
                  style={{ width: `${insight.score}%` }}
                />
              </div>
              <p className="mt-2 text-sm text-white/45">
                Distance from previous close is {distanceFromPrev.toFixed(2)}%, with Rs.{' '}
                {fmt(price.turnover ?? 0)} turnover.
              </p>
            </Card>
            <Card className="p-5">
              <div className="mb-4 flex items-center gap-2">
                <Calculator className="h-4 w-4 text-amber-300" aria-hidden="true" />
                <h4 className="text-sm font-semibold text-white">Quick Levels</h4>
              </div>
              <div className="grid gap-2 text-sm">
                <LevelRow label="Break Above" value={`Rs. ${fmt(price.high)}`} />
                <LevelRow label="Watch Below" value={`Rs. ${fmt(price.low)}`} />
                <LevelRow label="Reclaim" value={`Rs. ${fmt(price.prevClose)}`} />
              </div>
            </Card>
          </section>
        </div>
      </motion.aside>
    </div>
  );
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.03] p-4">
      <div className="truncate text-xs uppercase tracking-wider text-white/40">{label}</div>
      <div className="mt-2 truncate text-lg font-semibold tabular-nums text-white">{value}</div>
    </div>
  );
}

function LevelRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2">
      <span className="text-white/45">{label}</span>
      <span className="font-mono font-semibold tabular-nums text-white">{value}</span>
    </div>
  );
}

function MarketStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof BarChart3;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.03] p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="truncate text-xs uppercase tracking-wider text-white/40">{label}</span>
        <Icon className="h-4 w-4 shrink-0 text-white/35" aria-hidden="true" />
      </div>
      <div className="truncate text-lg font-semibold tabular-nums text-white">{value}</div>
    </div>
  );
}
